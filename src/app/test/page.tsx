"use client";

import { useState, useRef, useEffect } from "react";
import MessageItem from "@/components/MessageItem";
import MessageInput from "@/components/MessageInput";
import EmptyState from "@/components/EmptyState";
import { formatTime } from "@/utils/formatTime";
import { parseTimeToSeconds } from "@/utils/parseTimeToSeconds";
import VideoControls from "@/components/VideoControls";

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
	const [videoUrl, setVideoUrl] = useState<string>("");
	const [startTime, setStartTime] = useState<string>("00:00:00");
	const [endTime, setEndTime] = useState<string>("00:00:00");
	const [processing, setProcessing] = useState(false);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [filters, setFilters] = useState<VideoFilters>({
		brightness: 100,
		contrast: 100,
		saturation: 100,
		rotation: 0,
		filter: "none",
		volume: 1,
	});

	const [messages, setMessages] = useState<
		{ text: string; sender: "user" | "ai"; title?: string }[]
	>([]);

	const [newMessage, setNewMessage] = useState("");
	const chatContainerRef = useRef<HTMLDivElement>(null);

	const finishNowEventListenerRef = useRef<() => void>(() => {});

	const [animationInProgress, setAnimationInProgress] =
		useState<boolean>(false);
	const [animationFinished, setAnimationFinished] = useState<boolean>(false);

	const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (videoUrl) {
				URL.revokeObjectURL(videoUrl);
			}
			const newVideoUrl = URL.createObjectURL(file);
			setVideo(file);
			setVideoUrl(newVideoUrl);
			setStartTime("00:00:00");
			setEndTime("00:00:00");
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
		};
	}, [videoUrl]);

	const handleCutVideo = async (download: boolean = true) => {
		if (!video) return;
		setProcessing(true);

		try {
			const formData = new FormData();
			formData.append("video", video);
			formData.append(
				"cuts",
				JSON.stringify([
					{
						cutStartTime: 0,
						cutEndTime: 2,
					},
				])
			);
			formData.append("filters", JSON.stringify(filters));

			const response = await fetch("/api/cut-video", {
				method: "POST",
				body: formData,
			});

			if (response.ok) {
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);
				if (download) {
					const a = document.createElement("a");
					a.href = url;
					a.download = "trimmed-video.mp4";
					document.body.appendChild(a);
					a.click();
					URL.revokeObjectURL(url);
					document.body.removeChild(a);
				} else {
					setVideo(
						new File([blob], "trimmed-video.mp4", { type: "video/mp4" })
					);
					setVideoUrl(url);
				}
			}
		} catch (error) {
			console.error("Error cutting video:", error);
		} finally {
			setProcessing(false);
		}
	};

	const handleRemoveVideo = () => {
		if (videoUrl) {
			URL.revokeObjectURL(videoUrl);
		}
		setVideo(null);
		setVideoUrl("");
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

	const simulateTask = async () => {
		if (videoRef.current) {
			const currentEndTime = parseTimeToSeconds(endTime);
			const newEndTime = Math.max(0, currentEndTime - 1);
			setEndTime(formatTime(newEndTime));

			handleCutVideo(false);
		}
	};

	const handleSendMessage = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newMessage.trim()) return;

		// Add user message
		const userMessage = { text: newMessage, sender: "user" as const };
		setMessages((prev) => [...prev, userMessage]);
		setNewMessage("");

		if (!animationInProgress && !animationFinished) {
			setAnimationInProgress(true);
			setIsPlaying(false);
		} else if (animationInProgress) {
			finishNowEventListenerRef.current();
		}

		const response = {
			tasks: [
				{
					name: "generate_visuals",
					description: "I will generate visuals now...",
				},
				{
					name: "remove_unnecessary_audio",
					description: "I will trim the video now...",
				},
			],
		};

		await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call

		const tasks = response.tasks;

		for (const task of tasks) {
			const message = `${task.description}`; // TODO: Change to whatever looks best design wise
			const aiMessage = {
				text: message,
				sender: "ai" as const,
				title: "Editing...",
			};
			setMessages((prev) => [...prev, aiMessage]);

			if (task.name === "generate_visuals") {
				await simulateTask();
			}
		}
	};

	useEffect(() => {
		// Scroll to bottom
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
		<div className="flex gap-[19px] h-full">
			{/* Main Content */}
			<div className="w-[510px] flex-shrink-0">
				<div className="bg-white rounded-[30px] shadow-sm dark:bg-[#111111] overflow-hidden h-[904px] flex items-center flex-col pt-[57px] px-[62px] gap-[17px]">
					<div className="bg-black rounded-[30px] overflow-hidden relative w-[386px] h-[688px]">
						<video
							ref={videoRef}
							src={videoUrl}
							controls={false}
							className={`w-full h-full object-contain cursor-pointer ${
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

					{/* Video Controls - only timeline */}
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
				<div className="hidden p-4 border-b border-gray-200 dark:border-gray-700 items-center justify-between">
					<h3 className="text-lg font-semibold text-gray-900 dark:text-white">
						Spielberg
					</h3>
					<div className="flex items-center gap-2">
						<button
							onClick={() => handleCutVideo(false)}
							disabled={processing}
							className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
						>
							{processing ? (
								<>
									<svg
										className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											className="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											strokeWidth="4"
										/>
										<path
											className="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										/>
									</svg>
									Processing...
								</>
							) : (
								<>
									<svg
										className="w-4 h-4 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
										/>
									</svg>
									Export
								</>
							)}
						</button>
						<button
							onClick={handleRemoveVideo}
							className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
						>
							<svg
								className="w-4 h-4 mr-2"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							Remove
						</button>
					</div>
				</div>

				{/* Messages Container */}
				<div
					ref={chatContainerRef}
					className="overflow-y-auto p-4 h-[904px] pb-[150px] flex flex-col gap-[31px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#111111] [&::-webkit-scrollbar-thumb]:bg-[#1C1E24] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:rounded-full"
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
				/>
			</div>
		</div>
	);
}
