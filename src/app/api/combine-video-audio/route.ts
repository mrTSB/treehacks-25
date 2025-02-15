import { NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const videoSource = formData.get('videoSource') as File;
    const audioSource = formData.get('audioSource') as File;

    if (!videoSource || !audioSource) {
      return NextResponse.json(
        { error: 'Missing video or audio source' },
        { status: 400 }
      );
    }

    // Create temporary files
    const videoPath = join(tmpdir(), `video-${Date.now()}.mp4`);
    const audioPath = join(tmpdir(), `audio-${Date.now()}.mp4`);
    const outputPath = join(tmpdir(), `output-${Date.now()}.mp4`);

    // Write uploaded files to temp directory
    await writeFile(videoPath, Buffer.from(await videoSource.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audioSource.arrayBuffer()));

    // Combine video and audio, trimming video to match audio duration
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        // Remove original audio from video
        .outputOptions([
          '-map', '0:v:0',  // take video from first input
          '-map', '1:a:0',  // take audio from second input
          '-shortest'       // cut to shortest duration (audio length)
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Read the processed file
    const processedVideo = await readFile(outputPath);

    // Clean up temp files
    await Promise.all([
      unlink(videoPath),
      unlink(audioPath),
      unlink(outputPath)
    ]);

    return new NextResponse(processedVideo, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="combined-video.mp4"'
      }
    });
  } catch (error) {
    console.error('Error combining video and audio:', error);
    return NextResponse.json(
      { error: 'Error combining video and audio' },
      { status: 500 }
    );
  }
} 