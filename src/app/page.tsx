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

export default function Home() {
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('00:00:00');
  const [endTime, setEndTime] = useState<string>('00:00:00');
  const [processing, setProcessing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<'start' | 'end' | null>(null);
  const [filters, setFilters] = useState<VideoFilters>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    rotation: 0,
    filter: 'none',
    volume: 1
  });
  const [cleanupProcessing, setCleanupProcessing] = useState(false);

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

  const handleMarkerMouseDown = (type: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation();
    isDraggingRef.current = type;
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !timelineRef.current || !duration) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = formatTime(percentage * duration);

    if (isDraggingRef.current === 'start') {
      setStartTime(newTime);
    } else {
      setEndTime(newTime);
    }
  };

  const handleTimelineMouseUp = () => {
    isDraggingRef.current = null;
  };

  useEffect(() => {
    document.addEventListener('mouseup', handleTimelineMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleTimelineMouseUp);
    };
  }, []);

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

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = Math.min(1, newVolume);
    }
    setFilters(prev => ({ ...prev, volume: newVolume }));
    setIsMuted(newVolume === 0);
  };

  const handleMuteToggle = () => {
    if (videoRef.current) {
      const newMutedState = !isMuted;
      const newVolume = newMutedState ? 0 : 1;
      videoRef.current.muted = newMutedState;
      setIsMuted(newMutedState);
      setVolume(newVolume);
      setFilters(prev => ({ ...prev, volume: newVolume }));
    }
  };

  const handleSpeedChange = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
      setPlaybackSpeed(speed);
    }
  };

  const handleFilterChange = (type: keyof VideoFilters, value: number | string) => {
    setFilters(prev => ({ ...prev, [type]: value }));
  };

  const getFilterStyle = () => {
    const { brightness, contrast, saturation, rotation, filter } = filters;
    let filterString = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    
    if (filter !== 'none') {
      switch (filter) {
        case 'grayscale':
          filterString += ' grayscale(100%)';
          break;
        case 'sepia':
          filterString += ' sepia(100%)';
          break;
        case 'invert':
          filterString += ' invert(100%)';
          break;
      }
    }

    return {
      filter: filterString,
      transform: `rotate(${rotation}deg)`,
      transition: 'filter 0.3s ease, transform 0.3s ease'
    };
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

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white">
            AI Editor
          </h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Professional Video Editor
          </div>
        </div>
        
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
            <div className="flex-1 space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 space-y-4">
                  <div className="aspect-video bg-black rounded-lg overflow-hidden">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      controls={false}
                      className="w-full h-full"
                      style={getFilterStyle()}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                    />
                  </div>
                  
                  {/* Video Controls */}
                  <div className="space-y-4">
                    {/* Primary Controls */}
                    <div className="flex flex-col items-center space-y-3">
                      {/* Time and Duration */}
                      <div className="text-sm font-medium text-gray-600 dark:text-gray-300 tracking-wide">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </div>

                      {/* Playback Controls */}
                      <div className="flex items-center justify-center space-x-4">
                        <button
                          onClick={() => handleSeek(-10)}
                          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          title="Rewind 10 seconds"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                          </svg>
                        </button>

                        <button
                          onClick={handlePlayPause}
                          className="p-3 rounded-lg bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors shadow-sm"
                        >
                          {isPlaying ? (
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          ) : (
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </button>

                        <button
                          onClick={() => handleSeek(10)}
                          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          title="Fast forward 10 seconds"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                          </svg>
                        </button>

                        <select
                          value={playbackSpeed}
                          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                          className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <option value="0.5">0.5x</option>
                          <option value="1">1x</option>
                          <option value="1.5">1.5x</option>
                          <option value="2">2x</option>
                        </select>
                      </div>
                    </div>

                    {/* Timeline container */}
                    <div className="space-y-4">
                      <div 
                        ref={timelineRef}
                        className="relative h-12 bg-gray-100 dark:bg-gray-700/50 rounded-lg cursor-pointer group"
                        onClick={handleTimelineClick}
                        onMouseMove={handleTimelineMouseMove}
                      >
                        {/* Progress bar */}
                        <div 
                          className="absolute h-full bg-gray-200 dark:bg-gray-600/50 rounded-lg transition-all"
                          style={{ width: `${currentTimePercentage}%` }}
                        />
                        
                        {/* Selection range */}
                        <div 
                          className="absolute h-full bg-blue-100 dark:bg-blue-900/30 rounded-lg transition-all"
                          style={{ 
                            left: `${startTimePercentage}%`,
                            width: `${endTimePercentage - startTimePercentage}%`
                          }}
                        />

                        {/* Start marker */}
                        <div
                          className="absolute top-0 w-1 h-full bg-blue-600 dark:bg-blue-400 cursor-ew-resize hover:w-1.5 transition-all"
                          style={{ left: `${startTimePercentage}%` }}
                          onMouseDown={handleMarkerMouseDown('start')}
                        >
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-white dark:bg-gray-800 shadow-sm text-xs font-medium">
                            {startTime}
                          </div>
                        </div>

                        {/* End marker */}
                        <div
                          className="absolute top-0 w-1 h-full bg-blue-600 dark:bg-blue-400 cursor-ew-resize hover:w-1.5 transition-all"
                          style={{ left: `${endTimePercentage}%` }}
                          onMouseDown={handleMarkerMouseDown('end')}
                        >
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-white dark:bg-gray-800 shadow-sm text-xs font-medium">
                            {endTime}
                          </div>
                        </div>

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

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Start Time
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              value={startTime}
                              onChange={(e) => setStartTime(e.target.value)}
                              className="w-full px-3 py-2 pl-8 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400 dark:focus:border-blue-400 text-sm"
                              pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                            />
                            <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            End Time
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              value={endTime}
                              onChange={(e) => setEndTime(e.target.value)}
                              className="w-full px-3 py-2 pl-8 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400 dark:focus:border-blue-400 text-sm"
                              pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                            />
                            <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end space-x-3 pt-2">
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
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="w-80 shrink-0 space-y-4">
              {/* Audio Controls */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Audio</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Volume</label>
                      <button
                        onClick={handleMuteToggle}
                        className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        {isMuted ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {Math.round(volume * 100)}%
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Bass Boost</label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={filters.bassBoost || 1}
                      onChange={(e) => handleFilterChange('bassBoost', parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Treble</label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={filters.treble || 1}
                      onChange={(e) => handleFilterChange('treble', parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                  </div>
                </div>
              </div>

              {/* Video Adjustments */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Video</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brightness</label>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={filters.brightness}
                      onChange={(e) => handleFilterChange('brightness', parseInt(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {filters.brightness}%
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contrast</label>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={filters.contrast}
                      onChange={(e) => handleFilterChange('contrast', parseInt(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {filters.contrast}%
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Saturation</label>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={filters.saturation}
                      onChange={(e) => handleFilterChange('saturation', parseInt(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600 dark:accent-blue-400"
                    />
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {filters.saturation}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Rotation */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Rotation</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 90, 180, 270].map((deg) => (
                    <button
                      key={deg}
                      onClick={() => handleFilterChange('rotation', deg)}
                      className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        filters.rotation === deg
                          ? 'bg-blue-600 dark:bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>

              {/* Filters */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Filters</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['none', 'grayscale', 'sepia', 'invert'].map((filterName) => (
                    <button
                      key={filterName}
                      onClick={() => handleFilterChange('filter', filterName)}
                      className={`px-3 py-2 text-sm font-medium rounded-md capitalize transition-colors ${
                        filters.filter === filterName
                          ? 'bg-blue-600 dark:bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {filterName}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  setFilters({
                    brightness: 100,
                    contrast: 100,
                    saturation: 100,
                    rotation: 0,
                    filter: 'none',
                    volume: 1,
                    bassBoost: 1,
                    treble: 1
                  });
                }}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Reset All
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
