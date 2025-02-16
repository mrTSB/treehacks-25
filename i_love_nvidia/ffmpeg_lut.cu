#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <stdexcept>
#include <algorithm>
#include <cuda_runtime.h>

extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}

// Macro for CUDA error checking.
#define CUDA_CHECK(call)                                            \
    do {                                                            \
        cudaError_t err = call;                                     \
        if (err != cudaSuccess) {                                   \
            std::cerr << "CUDA Error: " << cudaGetErrorString(err)  \
                      << " at " << __FILE__ << ":" << __LINE__       \
                      << std::endl;                                 \
            exit(EXIT_FAILURE);                                     \
        }                                                           \
    } while (0)

// Macro for FFmpeg error checking.
#define AV_CHECK(err) do { \
    if ((err) < 0) { \
        char errbuf[128]; \
        av_strerror((err), errbuf, sizeof(errbuf)); \
        std::cerr << "FFmpeg error: " << errbuf << " at " << __FILE__ << ":" << __LINE__ << std::endl; \
        exit(1); \
    } \
} while(0)

// Device helper: linear interpolation for float3.
__device__ inline float3 lerp(const float3 &a, const float3 &b, float t) {
    return make_float3(a.x + t * (b.x - a.x),
                       a.y + t * (b.y - a.y),
                       a.z + t * (b.z - a.z));
}

// Device helper function to get LUT value
__device__ float3 getLut(int rr, int gg, int bb, const float* d_lut, int lutSize) {
    int index = ((rr * lutSize * lutSize) + (gg * lutSize) + bb) * 3;
    return make_float3(d_lut[index], d_lut[index+1], d_lut[index+2]);
}

// CUDA kernel: applies a 3D LUT via trilinear interpolation.
// d_input and d_output are RGB24 images (width*height*3 bytes).
// d_lut is a flattened LUT array (lutSize^3*3 floats).
__global__ void applyLUTKernel(const unsigned char* d_input, unsigned char* d_output,
                               int width, int height, const float* d_lut, int lutSize) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= width || y >= height)
        return;
    int idx = (y * width + x) * 3;
    
    // Check if input is pure white
    if (d_input[idx] == 255 && d_input[idx+1] == 255 && d_input[idx+2] == 255) {
        d_output[idx] = d_output[idx+1] = d_output[idx+2] = 255;
        return;
    }
    
    float r = d_input[idx]   / 255.f;
    float g = d_input[idx+1] / 255.f;
    float b = d_input[idx+2] / 255.f;
    float fr = r * (lutSize - 1);
    float fg = g * (lutSize - 1);
    float fb = b * (lutSize - 1);
    int r0 = floorf(fr), g0 = floorf(fg), b0 = floorf(fb);
    int r1 = min(r0 + 1, lutSize - 1);
    int g1 = min(g0 + 1, lutSize - 1);
    int b1 = min(b0 + 1, lutSize - 1);
    float dr = fr - r0, dg = fg - g0, db = fb - b0;
    
    float3 c000 = getLut(r0, g0, b0, d_lut, lutSize);
    float3 c100 = getLut(r1, g0, b0, d_lut, lutSize);
    float3 c010 = getLut(r0, g1, b0, d_lut, lutSize);
    float3 c001 = getLut(r0, g0, b1, d_lut, lutSize);
    float3 c101 = getLut(r1, g0, b1, d_lut, lutSize);
    float3 c011 = getLut(r0, g1, b1, d_lut, lutSize);
    float3 c110 = getLut(r1, g1, b0, d_lut, lutSize);
    float3 c111 = getLut(r1, g1, b1, d_lut, lutSize);
    
    float3 c00 = lerp(c000, c100, dr);
    float3 c01 = lerp(c001, c101, dr);
    float3 c10 = lerp(c010, c110, dr);
    float3 c11 = lerp(c011, c111, dr);
    float3 c0 = lerp(c00, c10, dg);
    float3 c1 = lerp(c01, c11, dg);
    float3 c  = lerp(c0,  c1,  db);

    // Ensure we preserve full range output
    d_output[idx]   = static_cast<unsigned char>(fminf(fmaxf(c.x * 255.f + 0.5f, 0.f), 255.f));
    d_output[idx+1] = static_cast<unsigned char>(fminf(fmaxf(c.y * 255.f + 0.5f, 0.f), 255.f));
    d_output[idx+2] = static_cast<unsigned char>(fminf(fmaxf(c.z * 255.f + 0.5f, 0.f), 255.f));
}

// Structure to hold a 3D LUT.
struct LUT3D {
    int size;
    std::vector<float> data; // Contains size^3 * 3 entries.
};

// Parses a .lut file expecting a header line "LUT_3D_SIZE N" followed by N^3 lines with three floats.
LUT3D loadLUT(const std::string& filename) {
    std::ifstream file(filename);
    if (!file.is_open())
        throw std::runtime_error("Failed to open LUT file: " + filename);
    LUT3D lut;
    std::string line;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::istringstream iss(line);
        std::string token;
        iss >> token;
        if (token == "LUT_3D_SIZE") {
            if (!(iss >> lut.size) || lut.size <= 0)
                throw std::runtime_error("Invalid LUT size in header.");
            break;
        }
    }
    if (lut.size <= 0)
        throw std::runtime_error("LUT size not specified in LUT file.");
    size_t expectedEntries = lut.size * lut.size * lut.size * 3;
    lut.data.reserve(expectedEntries);
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::istringstream iss(line);
        float r, g, b;
        if (!(iss >> r >> g >> b))
            continue;
        lut.data.push_back(r);
        lut.data.push_back(g);
        lut.data.push_back(b);
    }
    if (lut.data.size() != expectedEntries)
        throw std::runtime_error("LUT file does not contain the expected number of entries.");
    return lut;
}

int main(int argc, char* argv[]) {
    if (argc < 4) {
        std::cerr << "Usage: " << argv[0] << " <lut_file> <input_video> <output_video>" << std::endl;
        return EXIT_FAILURE;
    }
    std::string lutFile = argv[1];
    std::string inputVideo = argv[2];
    std::string outputVideo = argv[3];

    // Initialize all pointers to nullptr
    AVFormatContext* inFmtCtx = nullptr;
    AVFormatContext* outFmtCtx = nullptr;
    AVCodecContext* decCtx = nullptr;
    AVCodecContext* encCtx = nullptr;
    AVFrame* decFrame = nullptr;
    AVFrame* rgbFrame = nullptr;
    AVFrame* encFrame = nullptr;
    AVPacket* packet = nullptr;
    SwsContext* swsCtxToRGB = nullptr;
    SwsContext* swsCtxFromRGB = nullptr;
    unsigned char *d_input = nullptr, *d_output = nullptr;
    float* d_lut = nullptr;

    // Load LUT and copy it to device memory.
    LUT3D lut;
    try {
        lut = loadLUT(lutFile);
    } catch (const std::exception &ex) {
        std::cerr << "LUT loading error: " << ex.what() << std::endl;
        return EXIT_FAILURE;
    }
    size_t lutBytes = lut.data.size() * sizeof(float);
    CUDA_CHECK(cudaMalloc(&d_lut, lutBytes));
    CUDA_CHECK(cudaMemcpy(d_lut, lut.data.data(), lutBytes, cudaMemcpyHostToDevice));

    // Open the input video file.
    int ret = avformat_open_input(&inFmtCtx, inputVideo.c_str(), nullptr, nullptr);
    AV_CHECK(ret);
    ret = avformat_find_stream_info(inFmtCtx, nullptr);
    AV_CHECK(ret);

    // Find the video stream.
    int videoStreamIndex = -1;
    for (unsigned int i = 0; i < inFmtCtx->nb_streams; i++) {
        if (inFmtCtx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            videoStreamIndex = i;
            break;
        }
    }
    if (videoStreamIndex == -1) {
        std::cerr << "No video stream found." << std::endl;
        return EXIT_FAILURE;
    }
    AVStream* videoStream = inFmtCtx->streams[videoStreamIndex];

    // Open the decoder.
    const AVCodec* decoder = avcodec_find_decoder(videoStream->codecpar->codec_id);
    if (!decoder) {
        std::cerr << "Decoder not found." << std::endl;
        return EXIT_FAILURE;
    }
    decCtx = avcodec_alloc_context3(decoder);
    if (!decCtx) {
        std::cerr << "Failed to allocate decoder context." << std::endl;
        return EXIT_FAILURE;
    }
    ret = avcodec_parameters_to_context(decCtx, videoStream->codecpar);
    AV_CHECK(ret);
    ret = avcodec_open2(decCtx, decoder, nullptr);
    AV_CHECK(ret);

    // Set up a SwsContext to convert the decoded frame to RGB24 (which our CUDA kernel expects).
    swsCtxToRGB = sws_getContext(decCtx->width, decCtx->height, decCtx->pix_fmt,
                                             decCtx->width, decCtx->height, AV_PIX_FMT_RGB24,
                                             SWS_BILINEAR, nullptr, nullptr, nullptr);
    if (!swsCtxToRGB) {
        std::cerr << "Could not initialize sws context for RGB conversion." << std::endl;
        return EXIT_FAILURE;
    }

    // Set up the output file and encoder.
    ret = avformat_alloc_output_context2(&outFmtCtx, nullptr, nullptr, outputVideo.c_str());
    if (!outFmtCtx) {
        std::cerr << "Could not create output context." << std::endl;
        return EXIT_FAILURE;
    }
    const AVCodec* encoder = avcodec_find_encoder(AV_CODEC_ID_H264);
    if (!encoder) {
        std::cerr << "Necessary encoder not found." << std::endl;
        return EXIT_FAILURE;
    }
    AVStream* outStream = avformat_new_stream(outFmtCtx, nullptr);
    if (!outStream) {
        std::cerr << "Failed allocating output stream." << std::endl;
        return EXIT_FAILURE;
    }

    encCtx = avcodec_alloc_context3(encoder);
    if (!encCtx) {
        std::cerr << "Failed to allocate encoder context." << std::endl;
        return EXIT_FAILURE;
    }

    // Set encoder parameters
    encCtx->width = decCtx->width;
    encCtx->height = decCtx->height;
    encCtx->sample_aspect_ratio = decCtx->sample_aspect_ratio;
    encCtx->pix_fmt = AV_PIX_FMT_YUV420P;

    // Set reasonable defaults for x264 encoding
    encCtx->bit_rate = 2000000;  // 2 Mbps
    encCtx->rc_max_rate = 2000000;
    encCtx->rc_min_rate = 2000000;
    encCtx->rc_buffer_size = 4000000;  // 2 seconds worth of data
    encCtx->gop_size = 12;
    encCtx->max_b_frames = 2;
    encCtx->thread_count = 0;  // Let FFmpeg decide thread count
    
    // Set timebase and framerate
    if (videoStream->r_frame_rate.num && videoStream->r_frame_rate.den) {
        encCtx->framerate = videoStream->r_frame_rate;
        encCtx->time_base = av_inv_q(videoStream->r_frame_rate);
    } else {
        encCtx->framerate = (AVRational){25, 1};  // Default to 25 fps
        encCtx->time_base = (AVRational){1, 25};
    }
    
    // Set stream timebase to match input
    outStream->time_base = videoStream->time_base;
    
    if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER)
        encCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

    // Set x264 encoding preset and tune
    AVDictionary *param = nullptr;
    av_dict_set(&param, "preset", "medium", 0);
    av_dict_set(&param, "tune", "film", 0);
    av_dict_set(&param, "profile", "high", 0);
    av_dict_set(&param, "level", "4.0", 0);
    av_dict_set(&param, "rc-lookahead", "20", 0);
    
    ret = avcodec_open2(encCtx, encoder, &param);
    av_dict_free(&param);
    AV_CHECK(ret);

    // Copy encoder parameters to output stream
    ret = avcodec_parameters_from_context(outStream->codecpar, encCtx);
    AV_CHECK(ret);
    
    // Copy relevant stream metadata
    av_dict_copy(&outStream->metadata, videoStream->metadata, 0);

    if (!(outFmtCtx->oformat->flags & AVFMT_NOFILE)) {
        ret = avio_open(&outFmtCtx->pb, outputVideo.c_str(), AVIO_FLAG_WRITE);
        AV_CHECK(ret);
    }
    ret = avformat_write_header(outFmtCtx, nullptr);
    AV_CHECK(ret);

    // Set up a SwsContext to convert RGB24 (processed by CUDA) to the encoder's pixel format.
    swsCtxFromRGB = sws_getContext(decCtx->width, decCtx->height, AV_PIX_FMT_RGB24,
                                               encCtx->width, encCtx->height, encCtx->pix_fmt,
                                               SWS_BILINEAR, nullptr, nullptr, nullptr);
    if (!swsCtxFromRGB) {
        std::cerr << "Could not initialize sws context for encoder conversion." << std::endl;
        return EXIT_FAILURE;
    }

    // Allocate frames for decoding, RGB conversion, and encoding.
    decFrame = av_frame_alloc();
    rgbFrame = av_frame_alloc();
    encFrame = av_frame_alloc();
    if (!decFrame || !rgbFrame || !encFrame) {
        std::cerr << "Could not allocate frames." << std::endl;
        return EXIT_FAILURE;
    }

    // Set up RGB frame
    rgbFrame->format = AV_PIX_FMT_RGB24;
    rgbFrame->width = decCtx->width;
    rgbFrame->height = decCtx->height;
    ret = av_frame_get_buffer(rgbFrame, 32);
    AV_CHECK(ret);

    // Set up encoding frame
    encFrame->format = encCtx->pix_fmt;
    encFrame->width = encCtx->width;
    encFrame->height = encCtx->height;
    ret = av_frame_get_buffer(encFrame, 32);
    AV_CHECK(ret);

    // Allocate CUDA device buffers for the frame.
    int frameBytes = rgbFrame->linesize[0] * rgbFrame->height;
    CUDA_CHECK(cudaMalloc(&d_input, frameBytes));
    CUDA_CHECK(cudaMalloc(&d_output, frameBytes));

    packet = av_packet_alloc();
    if (!packet) {
        std::cerr << "Failed to allocate packet." << std::endl;
        return EXIT_FAILURE;
    }

    // Main processing loop.
    int frameIndex = 0;
    while (av_read_frame(inFmtCtx, packet) >= 0) {
        if (packet->stream_index == videoStreamIndex) {
            ret = avcodec_send_packet(decCtx, packet);
            if (ret < 0) {
                std::cerr << "Error sending packet for decoding." << std::endl;
                break;
            }
            while (ret >= 0) {
                ret = avcodec_receive_frame(decCtx, decFrame);
                if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
                    break;
                else if (ret < 0) {
                    std::cerr << "Error during decoding." << std::endl;
                    break;
                }

                // Convert the decoded frame to RGB24.
                ret = av_frame_make_writable(rgbFrame);
                if (ret < 0) {
                    std::cerr << "Error making RGB frame writable." << std::endl;
                    break;
                }
                ret = sws_scale(swsCtxToRGB, decFrame->data, decFrame->linesize, 0, decCtx->height,
                          rgbFrame->data, rgbFrame->linesize);
                if (ret < 0) {
                    std::cerr << "Error converting frame to RGB." << std::endl;
                    break;
                }

                // Process the RGB frame with CUDA.
                CUDA_CHECK(cudaMemcpy(d_input, rgbFrame->data[0], frameBytes, cudaMemcpyHostToDevice));
                dim3 block(16, 16);
                dim3 grid((decCtx->width + block.x - 1) / block.x, (decCtx->height + block.y - 1) / block.y);
                applyLUTKernel<<<grid, block>>>(d_input, d_output, decCtx->width, decCtx->height, d_lut, lut.size);
                CUDA_CHECK(cudaDeviceSynchronize());
                CUDA_CHECK(cudaMemcpy(rgbFrame->data[0], d_output, frameBytes, cudaMemcpyDeviceToHost));

                // Create a new encoding frame for each frame
                AVFrame* newEncFrame = av_frame_alloc();
                if (!newEncFrame) {
                    std::cerr << "Could not allocate new encoding frame." << std::endl;
                    break;
                }
                newEncFrame->format = encCtx->pix_fmt;
                newEncFrame->width = encCtx->width;
                newEncFrame->height = encCtx->height;
                ret = av_frame_get_buffer(newEncFrame, 32);
                if (ret < 0) {
                    std::cerr << "Could not allocate new encoding frame buffer." << std::endl;
                    av_frame_free(&newEncFrame);
                    break;
                }

                // Convert the processed RGB frame to YUV420P for the encoder.
                ret = sws_scale(swsCtxFromRGB, rgbFrame->data, rgbFrame->linesize, 0, decCtx->height,
                          newEncFrame->data, newEncFrame->linesize);
                if (ret < 0) {
                    std::cerr << "Error converting frame to YUV." << std::endl;
                    av_frame_free(&newEncFrame);
                    break;
                }

                // Set frame properties
                newEncFrame->pts = av_rescale_q(decFrame->pts, videoStream->time_base, encCtx->time_base);
                newEncFrame->pkt_dts = AV_NOPTS_VALUE;
                newEncFrame->key_frame = 0;
                newEncFrame->pict_type = AV_PICTURE_TYPE_NONE;

                ret = avcodec_send_frame(encCtx, newEncFrame);
                if (ret < 0) {
                    std::cerr << "Error sending frame to encoder." << std::endl;
                    av_frame_free(&newEncFrame);
                    break;
                }

                // Retrieve and write the encoded packet.
                AVPacket* encPkt = av_packet_alloc();
                if (!encPkt) {
                    std::cerr << "Could not allocate packet." << std::endl;
                    av_frame_free(&newEncFrame);
                    break;
                }

                while (ret >= 0) {
                    ret = avcodec_receive_packet(encCtx, encPkt);
                    if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
                        break;
                    } else if (ret < 0) {
                        std::cerr << "Error during encoding." << std::endl;
                        break;
                    }
                    
                    // Set packet stream index and rescale timestamps
                    encPkt->stream_index = outStream->index;
                    av_packet_rescale_ts(encPkt, encCtx->time_base, outStream->time_base);
                    
                    // Write the packet
                    ret = av_interleaved_write_frame(outFmtCtx, encPkt);
                    if (ret < 0) {
                        char errbuf[AV_ERROR_MAX_STRING_SIZE];
                        av_strerror(ret, errbuf, sizeof(errbuf));
                        std::cerr << "Error writing frame: " << errbuf << std::endl;
                    }
                }
                av_packet_free(&encPkt);
                av_frame_unref(decFrame);
                av_frame_free(&newEncFrame);
            }
        }
        av_packet_unref(packet);
    }

    // Flush the decoder.
    avcodec_send_packet(decCtx, nullptr);
    while (avcodec_receive_frame(decCtx, decFrame) == 0) {
        // Convert the decoded frame to RGB24.
        ret = av_frame_make_writable(rgbFrame);
        if (ret < 0) {
            std::cerr << "Error making RGB frame writable." << std::endl;
            break;
        }
        ret = sws_scale(swsCtxToRGB, decFrame->data, decFrame->linesize, 0, decCtx->height,
                  rgbFrame->data, rgbFrame->linesize);
        if (ret < 0) {
            std::cerr << "Error converting frame to RGB." << std::endl;
            break;
        }

        // Process the RGB frame with CUDA.
        CUDA_CHECK(cudaMemcpy(d_input, rgbFrame->data[0], frameBytes, cudaMemcpyHostToDevice));
        dim3 block(16, 16);
        dim3 grid((decCtx->width + block.x - 1) / block.x, (decCtx->height + block.y - 1) / block.y);
        applyLUTKernel<<<grid, block>>>(d_input, d_output, decCtx->width, decCtx->height, d_lut, lut.size);
        CUDA_CHECK(cudaDeviceSynchronize());
        CUDA_CHECK(cudaMemcpy(rgbFrame->data[0], d_output, frameBytes, cudaMemcpyDeviceToHost));

        // Create a new encoding frame
        AVFrame* newEncFrame = av_frame_alloc();
        if (!newEncFrame) {
            std::cerr << "Could not allocate new encoding frame." << std::endl;
            break;
        }
        newEncFrame->format = encCtx->pix_fmt;
        newEncFrame->width = encCtx->width;
        newEncFrame->height = encCtx->height;
        ret = av_frame_get_buffer(newEncFrame, 32);
        if (ret < 0) {
            std::cerr << "Could not allocate new encoding frame buffer." << std::endl;
            av_frame_free(&newEncFrame);
            break;
        }

        // Convert the processed RGB frame to YUV420P for the encoder.
        ret = sws_scale(swsCtxFromRGB, rgbFrame->data, rgbFrame->linesize, 0, decCtx->height,
                  newEncFrame->data, newEncFrame->linesize);
        if (ret < 0) {
            std::cerr << "Error converting frame to YUV." << std::endl;
            av_frame_free(&newEncFrame);
            break;
        }

        // Set frame properties
        newEncFrame->pts = av_rescale_q(decFrame->pts, videoStream->time_base, encCtx->time_base);
        newEncFrame->pkt_dts = AV_NOPTS_VALUE;
        newEncFrame->key_frame = 0;
        newEncFrame->pict_type = AV_PICTURE_TYPE_NONE;

        ret = avcodec_send_frame(encCtx, newEncFrame);
        if (ret < 0) {
            std::cerr << "Error sending frame to encoder." << std::endl;
            av_frame_free(&newEncFrame);
            break;
        }

        // Retrieve and write the encoded packet.
        AVPacket* encPkt = av_packet_alloc();
        if (!encPkt) {
            std::cerr << "Could not allocate packet." << std::endl;
            av_frame_free(&newEncFrame);
            break;
        }

        while (ret >= 0) {
            ret = avcodec_receive_packet(encCtx, encPkt);
            if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
                break;
            } else if (ret < 0) {
                std::cerr << "Error during encoding." << std::endl;
                break;
            }
            
            // Set packet stream index and rescale timestamps
            encPkt->stream_index = outStream->index;
            av_packet_rescale_ts(encPkt, encCtx->time_base, outStream->time_base);
            
            // Write the packet
            ret = av_interleaved_write_frame(outFmtCtx, encPkt);
            if (ret < 0) {
                char errbuf[AV_ERROR_MAX_STRING_SIZE];
                av_strerror(ret, errbuf, sizeof(errbuf));
                std::cerr << "Error writing frame: " << errbuf << std::endl;
            }
        }
        av_packet_free(&encPkt);
        av_frame_free(&newEncFrame);
        av_frame_unref(decFrame);
    }

    // Flush the encoder
    ret = avcodec_send_frame(encCtx, nullptr);
    if (ret >= 0) {
        while (ret >= 0) {
            AVPacket* encPkt = av_packet_alloc();
            if (!encPkt) {
                std::cerr << "Could not allocate packet." << std::endl;
                break;
            }

            ret = avcodec_receive_packet(encCtx, encPkt);
            if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
                av_packet_free(&encPkt);
                break;
            } else if (ret < 0) {
                std::cerr << "Error during encoding." << std::endl;
                av_packet_free(&encPkt);
                break;
            }

            // Set packet stream index and rescale timestamps
            encPkt->stream_index = outStream->index;
            av_packet_rescale_ts(encPkt, encCtx->time_base, outStream->time_base);

            // Write the packet
            ret = av_interleaved_write_frame(outFmtCtx, encPkt);
            if (ret < 0) {
                char errbuf[AV_ERROR_MAX_STRING_SIZE];
                av_strerror(ret, errbuf, sizeof(errbuf));
                std::cerr << "Error writing frame: " << errbuf << std::endl;
            }
            av_packet_free(&encPkt);
        }
    }

    // Write the trailer and clean up
    ret = av_write_trailer(outFmtCtx);
    if (ret < 0) {
        char errbuf[AV_ERROR_MAX_STRING_SIZE];
        av_strerror(ret, errbuf, sizeof(errbuf));
        std::cerr << "Error writing trailer: " << errbuf << std::endl;
    }

    // Clean up in reverse order of allocation
    // First, close the output file
    if (outFmtCtx && !(outFmtCtx->oformat->flags & AVFMT_NOFILE)) {
        avio_closep(&outFmtCtx->pb);
    }

    // Free CUDA resources
    if (d_input) {
        cudaFree(d_input);
        d_input = nullptr;
    }
    if (d_output) {
        cudaFree(d_output);
        d_output = nullptr;
    }
    if (d_lut) {
        cudaFree(d_lut);
        d_lut = nullptr;
    }

    // Free SwsContext
    if (swsCtxToRGB) {
        sws_freeContext(swsCtxToRGB);
        swsCtxToRGB = nullptr;
    }
    if (swsCtxFromRGB) {
        sws_freeContext(swsCtxFromRGB);
        swsCtxFromRGB = nullptr;
    }

    // Free frames
    if (decFrame) {
        av_frame_free(&decFrame);
        decFrame = nullptr;
    }
    if (rgbFrame) {
        av_frame_free(&rgbFrame);
        rgbFrame = nullptr;
    }
    if (encFrame) {
        av_frame_free(&encFrame);
        encFrame = nullptr;
    }

    // Free packet
    if (packet) {
        av_packet_free(&packet);
        packet = nullptr;
    }

    // Free codec contexts
    if (decCtx) {
        avcodec_free_context(&decCtx);
        decCtx = nullptr;
    }
    if (encCtx) {
        avcodec_free_context(&encCtx);
        encCtx = nullptr;
    }

    // Close input and free contexts
    if (inFmtCtx) {
        avformat_close_input(&inFmtCtx);
        inFmtCtx = nullptr;
    }
    if (outFmtCtx) {
        avformat_free_context(outFmtCtx);
        outFmtCtx = nullptr;
    }

    std::cout << "Processing completed successfully." << std::endl;
    return EXIT_SUCCESS;
}
