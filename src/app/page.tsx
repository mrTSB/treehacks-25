'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import MessageItem from "@/components/MessageItem";
import MessageInput from "@/components/MessageInput";
import EmptyState from "@/components/EmptyState";
import VideoControls from "@/components/VideoControls";
import { formatTime } from "@/utils/formatTime";
import { parseTimeToSeconds } from "@/utils/parseTimeToSeconds";

interface VideoFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  filter: string;
  volume: number;
  bassBoost?: number;
  treble?: number;
}

type VideoInformation = {
  [timestamp: string]: string;
};

export default function Home() {
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('00:00:00');
  const [endTime, setEndTime] = useState<string>('00:00:00');
  const [processing, setProcessing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [videoInformation, setVideoInformation] = useState<VideoInformation>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<VideoFilters>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    rotation: 0,
    filter: 'none',
    volume: 1
  });
  const [cleanupProcessing, setCleanupProcessing] = useState(false);
  const [replacingVisuals, setReplacingVisuals] = useState(false);
  const [messages, setMessages] = useState<{ text: string; sender: 'user' | 'ai'; title?: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const [pulse, setPulse] = useState<boolean>(false);

  const finishNowEventListenerRef = useRef<() => void>(() => {});

  const [animationInProgress, setAnimationInProgress] = useState<boolean>(false);
  const [animationFinished, setAnimationFinished] = useState<boolean>(false);

  const analyzeVideoFrames = async (video: HTMLVideoElement) => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    console.log('Starting video analysis...');
    console.log('Video duration:', video.duration);

    // Set canvas size to match video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);

    // Capture frames every 0.5 seconds
    const frameInterval = 0.5; // 0.5 second between frames
    const totalFrames = Math.floor(video.duration / frameInterval);
    const newVideoInformation: VideoInformation = {};

    console.log('Total frames to process:', totalFrames);

    // Process frames in batches of 5 with delays between batches
    const batchSize = 5;
    const batches = Math.ceil(totalFrames / batchSize);
    console.log('Number of batches:', batches);

    for (let batch = 0; batch < batches; batch++) {
      console.log(`Processing batch ${batch + 1}/${batches}`);
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, totalFrames);

      // Process frames in current batch
      for (let i = batchStart; i < batchEnd; i++) {
        // Set video time to current frame
        const currentTime = i * frameInterval;
        video.currentTime = currentTime;
        console.log(`Processing frame at ${currentTime.toFixed(1)}s`);

        // Wait for the video to update to the new time
        await new Promise<void>((resolve) => {
          const handleSeeked = () => {
            video.removeEventListener('seeked', handleSeeked);
            resolve();
          };
          video.addEventListener('seeked', handleSeeked);
        });

        // Draw the current frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Get the frame as a base64 image
        const imageData = canvas.toDataURL('image/jpeg', 0.8);

        try {
          // Send frame to Gemini API
          const response = await fetch('/api/analyze-frame', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: imageData }),
          });

          if (response.ok) {
            const { description } = await response.json();
            newVideoInformation[currentTime.toFixed(1)] = description;
            console.log(`Frame ${currentTime.toFixed(1)}s description:`, description);
          }
        } catch (error) {
          console.error('Error analyzing frame:', error);
        }

        // Update progress
        const progress = ((i + 1) / totalFrames) * 100;
        setAnalysisProgress(progress);
        console.log(`Progress: ${Math.round(progress)}%`);
      }

      // Add delay between batches to avoid rate limiting
      if (batch < batches - 1) {
        console.log('Waiting between batches...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between batches
      }
    }

    console.log('Video analysis complete!');
    console.log('Final video information:', newVideoInformation);
    setVideoInformation(newVideoInformation);
    setIsAnalyzing(false);
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      const newVideoUrl = URL.createObjectURL(file);
      setVideo(file);
      setVideoUrl(newVideoUrl);
      setStartTime('00:00:00');
      setEndTime('00:00:00');

      // Create a temporary video element to analyze frames
      const tempVideo = document.createElement('video');
      tempVideo.src = newVideoUrl;

      // Wait for video metadata to load
      await new Promise<void>((resolve) => {
        tempVideo.addEventListener('loadedmetadata', () => resolve());
        tempVideo.load();
      });

      // Start frame analysis
      await analyzeVideoFrames(tempVideo);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setEndTime(formatTime(videoRef.current.duration));
    }
  };

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      setPulse(false);
    };
  }, [videoUrl]);

  const handleCutVideo = async (download: boolean = true, trimmingGuidance: string = '') => {
    if (!video) return;
    setProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('video', video);
      // Create cuts array with single cut
      let cuts = [];
      if (trimmingGuidance != "") {
        const [startTimeStr, endTimeStr] = trimmingGuidance.split(',').map(t => t.trim());
        cuts = [{
          cutStartTime: parseTimeToSeconds(startTimeStr),
          cutEndTime: parseTimeToSeconds(endTimeStr)
        }];
      } else {
          cuts = [{
            cutStartTime: 0,
          cutEndTime: parseTimeToSeconds(startTime)
        },
        {
          cutStartTime: parseTimeToSeconds(endTime),
          cutEndTime: duration
        }];
      }
      console.log(cuts);
      formData.append('cuts', JSON.stringify(cuts));
      formData.append('filters', JSON.stringify(filters));

      const response = await fetch('/api/cut-video', {
        method: 'POST',
        body: formData,
      });

      console.log(response);

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (download) {
          const a = document.createElement('a');
          a.href = url;
          a.download = 'trimmed-video.mp4';
          document.body.appendChild(a);
          a.click();
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          setVideo(new File([blob], 'trimmed-video.mp4', { type: 'video/mp4' }));
          setVideoUrl(url);
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
          }
          setCurrentTime(0);
          setIsPlaying(false);
        }
      }
    } catch (error) {
      console.error('Error cutting video:', error);
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveVideo = () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideo(null);
    setVideoUrl('');
  };

  const handlePlayPause = () => {
    if (animationInProgress) {
      return;
    }

    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleGeneratePodcastClip = useCallback(async () => {
    if (!video) return;
    setProcessing(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'second-python-layer',
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to save video');
          }
  
          const podcastResponse = await fetch(`http://localhost:8001/generate_podcast_clip`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ video_path: `raw/${video.name}` }),
          });
  
          if (!podcastResponse.ok) {
            throw new Error('Failed to generate podcast clip');
          }
  
          const result = await podcastResponse.json();
          console.log('Podcast result:', result);
  
          if (result.processed_file) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
  
            const filePath = result.processed_file;
            const readResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath, pythonLayer: 'second-python-layer' }),
            });
  
            if (!readResponse.ok) {
              throw new Error('Failed to read video file');
            }
  
            const videoBlob = await readResponse.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
  
            // Update the video state with the processed File so that subsequent ops use the new file
            const newVideoFile = new File([videoBlob], 'podcast-video.mp4', { type: video.type || 'video/mp4' });
            setVideo(newVideoFile);
  
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error generating podcast clip:', error);
          console.log('Failed to generate podcast clip');
        }
      };
  
      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error generating podcast clip:', error);
      alert('Failed to generate podcast clip');
    } finally {
      setProcessing(false);
    }
  }, [video, videoUrl]);

  const handleGenerateCaptions = useCallback(async () => {
    console.log('Generating captions');
    if (!video) return;
    setGeneratingCaptions(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'python-layer'
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to save video');
          }
  
          const captionsResponse = await fetch(`http://127.0.0.1:8000/generate-captions?filename=${video.name}`, {
            method: 'POST',
          });
  
          if (!captionsResponse.ok) {
            throw new Error('Failed to generate captions');
          }
  
          const result = await captionsResponse.json();
          console.log('Captions result:', result);
  
          if (result.processed_file) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            const filePath = result.processed_file;
            const readResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath, pythonLayer: 'python-layer' }),
            });
  
            if (!readResponse.ok) {
              throw new Error('Failed to read video file');
            }
  
            const videoBlob = await readResponse.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
  
            // Update the video state with the processed file
            const newVideoFile = new File([videoBlob], 'captioned-video.mp4', { type: video.type || 'video/mp4' });
            setVideo(newVideoFile);
  
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error generating captions:', error);
          console.log('Failed to generate captions');
        }
      };
  
      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error generating captions:', error);
      alert('Failed to generate captions');
    } finally {
      setGeneratingCaptions(false);
    }
  }, [video, videoUrl]);

  const handleCleanup = useCallback(async () => {
    if (!video) return;
    setCleanupProcessing(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'python-layer'
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to save video');
          }
  
          const cleanupResponse = await fetch(`http://localhost:8000/upload-video?filename=${video.name}`, {
            method: 'POST',
          });
  
          if (!cleanupResponse.ok) {
            throw new Error('Failed to process video');
          }
  
          const result = await cleanupResponse.json();
          console.log('Cleanup result:', result);
  
          if (result.processed_file) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            const filePath = result.processed_file;
            const readResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath, pythonLayer: 'python-layer' }),
            });
  
            if (!readResponse.ok) {
              throw new Error('Failed to read video file');
            }
  
            const videoBlob = await readResponse.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
  
            // Update video state with the cleaned up file
            const newVideoFile = new File([videoBlob], 'cleaned-video.mp4', { type: video.type || 'video/mp4' });
            setVideo(newVideoFile);
  
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error during cleanup:', error);
          console.log('Failed to clean up video');
        }
      };
  
      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error during cleanup:', error);
      alert('Failed to clean up video');
    } finally {
      setCleanupProcessing(false);
    }
  }, [video, videoUrl]);

  const handleReplaceVisuals = useCallback(async () => {
    if (!video) return;
    setReplacingVisuals(true);
    
    try {
      // Create a copy of the video file in the python-layer/raw directory
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'python-layer'
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to save video');
          }

          const createResponse = await fetch(`http://localhost:8000/create-video?filename=${video.name}`, {
            method: 'POST',
          });

          if (!createResponse.ok) {
            throw new Error('Failed to process video');
          }

          const result = await createResponse.json();
          console.log('Replace visuals result:', result);

          // Get the generated video and combine with original audio
          if (result.processed_file) {
            // Read the generated video file
            const generatedVideoResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath: result.processed_file, pythonLayer: 'python-layer' }),
            });

            if (!generatedVideoResponse.ok) {
              throw new Error('Failed to read generated video file');
            }

            // Create form data with both videos
            const formData = new FormData();
            formData.append('videoSource', await generatedVideoResponse.blob(), 'generated-video.mp4');
            formData.append('audioSource', video, 'original-video.mp4');

            // Combine video and audio
            const combineResponse = await fetch('/api/combine-video-audio', {
              method: 'POST',
              body: formData,
            });

            if (!combineResponse.ok) {
              throw new Error('Failed to combine video and audio');
            }

            // Update video with combined result
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            const combinedVideoBlob = await combineResponse.blob();
            const newVideoUrl = URL.createObjectURL(combinedVideoBlob);
            setVideoUrl(newVideoUrl);
            setVideo(new File([combinedVideoBlob], 'combined-video.mp4', { type: 'video/mp4' }));
            
            // Reset video state
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error during visual replacement:', error);
          console.log('Failed to replace visuals');
        }
      };

      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error during visual replacement:', error);
      alert('Failed to replace visuals');
    } finally {
      setReplacingVisuals(false);
    }
  }, [video]);

  const handleGenerateSoundEffects = useCallback(async () => {
    console.log('Generating sound effects');
    if (!video) return;
    setProcessing(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'second-python-layer'
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to save video');
          }
  
          const subtitledResponse = await fetch(`http://0.0.0.0:8001/generate_subtitled_video`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ video_path: `raw/${video.name}` }),
          });
  
          if (!subtitledResponse.ok) {
            throw new Error('Failed to generate subtitles');
          }
  
          const subtitledResult = await subtitledResponse.json();
  
          if (!subtitledResult?.output_video) {
            throw new Error('Invalid subtitle generation response');
          }
  
          const soundEffectsResponse = await fetch(`http://0.0.0.0:8001/generate_sound_effects_video`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              video_path: subtitledResult.output_video,
              srt_path: subtitledResult.output_video.replace('.mp4', '.srt')
            }),
          });
  
          if (!soundEffectsResponse.ok) {
            throw new Error('Failed to add sound effects');
          }
  
          const result = await soundEffectsResponse.json();
          console.log('Sound effects result:', result);
  
          if (result.output_video) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            const filePath = result.output_video;
            const readResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath, pythonLayer: 'second-python-layer' }),
            });
  
            if (!readResponse.ok) {
              throw new Error('Failed to read video file');
            }
  
            const videoBlob = await readResponse.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
  
            // Update video state with the new file that has sound effects added
            const newVideoFile = new File([videoBlob], 'sound-effects-video.mp4', { type: video.type || 'video/mp4' });
            setVideo(newVideoFile);
  
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error generating sound effects:', error);
          console.log('Failed to generate sound effects');
        }
      };
  
      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error generating sound effects:', error);
      alert('Failed to generate sound effects');
    } finally {
      setProcessing(false);
    }
  }, [video, videoUrl]);

  const handleExtendVideo = useCallback(async () => {
    console.log('Extending video');
    if (!video) return;
    setProcessing(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'second-python-layer'
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to save video');
          }

          // Get the last frame from the video
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get canvas context');

          // Set canvas size to match video dimensions
          canvas.width = videoRef.current?.videoWidth || 0;
          canvas.height = videoRef.current?.videoHeight || 0;

          // Draw the current frame to canvas
          if (videoRef.current) {
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          }

          // Get the frame as a base64 image
          const imageData = canvas.toDataURL('image/jpeg', 0.8);

          // Get extension suggestions using the last frame and video context
          const extensionResponse = await fetch('/api/get-extension-prompt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              image: imageData,
              videoContext: JSON.stringify(videoInformation)
            }),
          });

          console.log(extensionResponse);

          if (!extensionResponse.ok) {
            throw new Error('Failed to get extension suggestions');
          }

          const { suggestions } = await extensionResponse.json();
          console.log('Extension suggestions:', suggestions);
  
          const extendResponse = await fetch(`http://0.0.0.0:8001/extend_video`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              video_path: `raw/${video.name}`,
              prompt: suggestions,
              duration: 5
            }),
          });
  
          if (!extendResponse.ok) {
            throw new Error('Failed to extend video');
          }
  
          const result = await extendResponse.json();
          console.log('Extend video result:', result);

          if (result) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            const filePath = result;
            const readResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath, pythonLayer: 'second-python-layer' }),
            });
  
            if (!readResponse.ok) {
              throw new Error('Failed to read video file');
            }
  
            const videoBlob = await readResponse.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
  
            // Update video state with the extended video
            const newVideoFile = new File([videoBlob], 'extended-video.mp4', { type: video.type || 'video/mp4' });
            setVideo(newVideoFile);
  
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error extending video:', error);
          console.log('Failed to extend video');
        }
      };
  
      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error extending video:', error);
      alert('Failed to extend video');
    } finally {
      setProcessing(false);
    }
  }, [video, videoUrl]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    // Add user message
    const userMessage = { text: newMessage, sender: 'user' as const };
    setMessages(prev => [...prev, userMessage]);
    setNewMessage('');

    const response = await fetch('/api/get-task-list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userPrompt: newMessage,
        videoInformation 
      }),
    });

    if (!animationInProgress && !animationFinished) {
      setAnimationInProgress(true);
      setIsPlaying(false);
    } else {
      setPulse(true);
    }

    const data = await response.json();
    const tasks = data.tasks;

    if (tasks.length > 0) {
      const task = tasks[0];
      const message =`${task.user_description}`;
      const aiMessage = { text: message, sender: 'ai' as const };
      setMessages(prev => [...prev, aiMessage]);

      if (task.name === 'generate_visuals') {
        await handleReplaceVisuals();
      } else if (task.name === 'remove_unnecessary_audio') {
        await handleCleanup();
      } else if (task.name === 'generate_text_overlay') {
        await handleGenerateCaptions();
      } else if (task.name === 'generate_podcast_clip') {
        await handleGeneratePodcastClip();
      } else if (task.name === 'add_sound_effects') {
        await handleGenerateSoundEffects();
      } else if (task.name === 'extend_video') {
        await handleExtendVideo();
      } else if (task.name === 'generate_voiceover') {
        await handleGenerateVoiceover();
      } else if (task.name === 'trim_based_on_visuals') {
        handleCutVideo(false, task.trimming_guidance);
      }
    }

    // Scroll to bottom
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  const handleGenerateVoiceover = useCallback(async () => {
    if (!video) return;
    setProcessing(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await fetch('/api/save-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: video.name,
              data: reader.result,
              pythonLayer: 'python-layer'
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to save video');
          }
  
          const voiceoverResponse = await fetch(`http://localhost:8000/generate-voiceover?filename=${video.name}`, {
            method: 'POST',
          });
  
          if (!voiceoverResponse.ok) {
            throw new Error('Failed to generate voiceover');
          }
  
          const result = await voiceoverResponse.json();
          console.log('Voiceover result:', result);
  
          if (result.processed_file) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            const filePath = result.processed_file;
            const readResponse = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath, pythonLayer: 'python-layer' }),
            });
  
            if (!readResponse.ok) {
              throw new Error('Failed to read video file');
            }
  
            const videoBlob = await readResponse.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
  
            // Update video state with the processed file
            const newVideoFile = new File([videoBlob], 'voiceover-video.mp4', { type: video.type || 'video/mp4' });
            setVideo(newVideoFile);
  
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
            }
            setCurrentTime(0);
            setIsPlaying(false);
          }
        } catch (error) {
          console.error('Error generating voiceover:', error);
          console.log('Failed to generate voiceover');
        }
      };
  
      reader.readAsDataURL(video);
    } catch (error) {
      console.error('Error generating voiceover:', error);
      alert('Failed to generate voiceover');
    } finally {
      setProcessing(false);
    }
  }, [video, videoUrl]);

  useEffect(() => {
    // Scroll to bottom when messages update
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  if (!video) {
    return <EmptyState handleVideoUpload={handleVideoUpload} />;
  }

  return (
    <div className="flex gap-[19px] h-screen">
      {/* Main Content */}
      <div className="w-[510px] flex-shrink-0">
        <div className="bg-white rounded-[30px] shadow-sm dark:bg-[#111111] overflow-hidden h-[904px] flex items-center flex-col pt-[57px] px-[62px] gap-[17px]">
          <div className="bg-black rounded-[30px] overflow-hidden relative w-[386px] h-[688px]">
            <video
              ref={videoRef}
              src={videoUrl}
              controls={false}
              className={`w-full h-full object-contain cursor-pointer ${pulse && "animate-pulse"} ${
                !animationInProgress ? "" : "animate-pulse cursor-progress"
              }`}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={handlePlayPause}
            />
            {!animationInProgress && !isPlaying && (
              <button
                onClick={handlePlayPause}
                className="absolute inset-0 w-full h-full flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
              >
                <div className="rounded-full bg-white/20 p-4">
                  <svg
                    className="w-12 h-12 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </button>
            )}
          </div>

          {/* Video Controls */}
          <VideoControls
            currentTime={currentTime}
            duration={duration}
            videoRef={videoRef}
            finishNowEventListenerRef={finishNowEventListenerRef}
            animationInProgress={animationInProgress}
            animationFinished={animationFinished}
            onAnimationFinished={() => {
              setAnimationFinished(true);
              setAnimationInProgress(false);

              setMessages((prev) => [
                ...prev,
                {
                  text: "I finished preparing your video.",
                  sender: "ai" as const,
                  title: "Done!",
                },
              ]);
            }}
          />
        </div>
      </div>

      {/* Chat Area */}
      <div className="bg-white dark:bg-[#111111] rounded-[30px] shadow-sm relative h-[904px] w-full overflow-hidden">
        {/* Messages Container */}
        <div
          ref={chatContainerRef}
          className="overflow-y-auto p-4 h-[904px] pb-[150px] flex flex-col gap-[31px] scrollbar-thin scrollbar-thumb-[#1C1E24] scrollbar-track-[#111111]"
        >
          {messages.map((message, index) => (
            <MessageItem key={index} message={message} />
          ))}
        </div>

        {/* Message Input */}
        <MessageInput
          handleSendMessage={handleSendMessage}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          handleViralize={() => console.log("Viralize")}
          handleExport={() => handleCutVideo(true)}
          />
        </div>
    </div>
  );
}