'use client';

import { useState, useRef, useEffect } from 'react';

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseTimeToSeconds(timeStr: string): number {
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

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

type Operation = {
  name: string;
  description: string;
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
  const [messages, setMessages] = useState<{ text: string; sender: 'user' | 'ai' }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !duration) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const startTimePercentage = (parseTimeToSeconds(startTime) / duration) * 100;
  const endTimePercentage = (parseTimeToSeconds(endTime) / duration) * 100;
  const currentTimePercentage = (currentTime / duration) * 100;

  const handleCutVideo = async () => {
    if (!video) return;
    setProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('video', video);
      formData.append('startTime', startTime);
      formData.append('endTime', endTime);
      formData.append('filters', JSON.stringify(filters));

      const response = await fetch('/api/cut-video', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'trimmed-video.mp4';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
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
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
    }
  };

  const handleCleanup = async () => {
    if (!video) return;
    setCleanupProcessing(true);
    
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
              data: reader.result
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

          // Update video source to the processed video
          if (result.processed_file) {
            if (videoUrl) {
              URL.revokeObjectURL(videoUrl);
            }
            // Read the local file directly
            const filePath = result.processed_file;
            const response = await fetch('/api/read-video', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ filePath }),
            });

            if (!response.ok) {
              throw new Error('Failed to read video file');
            }

            const videoBlob = await response.blob();
            const newVideoUrl = URL.createObjectURL(videoBlob);
            setVideoUrl(newVideoUrl);
            
            // Reset video state
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
  };

  const handleReplaceVisuals = async () => {
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
              data: reader.result
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
              body: JSON.stringify({ filePath: result.processed_file }),
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
  };

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
      body: JSON.stringify({ userPrompt: newMessage }),
    });

    const data = await response.json();
    
    const tasks = data.tasks;

    let message = "";

    for (const task of tasks) {
      message += `Performing ${task.name}: ${task.description}\n`;
    }

    // Simulate AI response (replace with actual API call)
    const aiMessage = { text: message, sender: 'ai' as const };
    setMessages(prev => [...prev, aiMessage]);

    // Scroll to bottom
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
        {!video ? (
          <div className="max-w-2xl mx-auto">
            <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800/50 shadow-sm">
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  className="hidden"
                  id="video-upload"
                />
                <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-3 mb-4">
                  <svg 
                    className="w-8 h-8 text-gray-500 dark:text-gray-400" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h18M3 16h18" />
                  </svg>
                </div>
                <label
                  htmlFor="video-upload"
                  className="cursor-pointer inline-flex items-center px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors dark:bg-blue-500 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-5 h-5 mr-2 -ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Upload Video
                </label>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  MP4, WebM, or Ogg
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex gap-6">
            {/* Main Content */}
            <div className="w-[400px] shrink-0 space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 space-y-4">
                  <div className="aspect-[9/16] bg-black rounded-lg overflow-hidden relative">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      controls={false}
                      className="w-full h-full object-contain cursor-pointer"
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onClick={handlePlayPause}
                    />
                    {!isPlaying && (
                      <button
                        onClick={handlePlayPause}
                        className="absolute inset-0 w-full h-full flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
                      >
                        <div className="rounded-full bg-white/20 p-4">
                          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      </button>
                    )}
                  </div>
                  
                  {/* Video Controls - only timeline */}
                  <div className="space-y-4">
                    <div className="flex flex-col items-center space-y-3">
                      {/* Time and Duration */}
                      <div className="text-sm font-medium text-gray-600 dark:text-gray-300 tracking-wide">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </div>

                      {/* Timeline */}
                      <div ref={timelineRef} onClick={handleTimelineClick} className="relative h-12 bg-gray-100 dark:bg-gray-700/50 rounded-lg cursor-pointer group w-full">
                        {/* Progress bar */}
                        <div 
                          className="absolute h-full bg-gray-200 dark:bg-gray-600/50 rounded-lg transition-all"
                          style={{ width: `${currentTimePercentage}%` }}
                        />
                        
                        {/* Current time marker */}
                        <div
                          className="absolute top-0 w-0.5 h-full bg-red-500 transition-all"
                          style={{ left: `${currentTimePercentage}%` }}
                        >
                          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-white dark:bg-gray-800 shadow-sm text-xs font-medium">
                            {formatTime(currentTime)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Chat Bar */}
            <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col h-[calc(100vh-8rem)]">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Assistant</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCutVideo}
                    disabled={processing}
                    className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    {processing ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Export
                      </>
                    )}
                  </button>
                  <button
              onClick={handleRemoveVideo}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove
            </button>
            
            <button
              onClick={handleCleanup}
              disabled={cleanupProcessing}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-green-600 dark:bg-green-500 rounded-md hover:bg-green-700 dark:hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              {cleanupProcessing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Cleaning...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Clean Up
                </>
              )}
            </button>
            
            <button
              onClick={handleReplaceVisuals}
              disabled={replacingVisuals}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-purple-600 dark:bg-purple-500 rounded-md hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              {replacingVisuals ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Replacing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Replace Visuals
                </>
              )}
            </button>
                </div>
              </div>
              
              {/* Messages Container */}
              <div 
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-4"
              >
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        message.sender === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                      }`}
                    >
                      <p className="text-sm">{message.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Message Input */}
              <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-gray-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
