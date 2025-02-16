import PlayheadIcon from "@/assets/PlayheadIcon";
import TicksIcon from "@/assets/TicksIcon";
import { formatTime } from "@/utils/formatTime";
import { getRandomInt } from "@/utils/getRandomInt";
import { memo, ReactNode, RefObject, useEffect, useRef, useState } from "react";

interface VideoControlsProps {
	currentTime: number;
	duration: number;
	videoRef: RefObject<HTMLVideoElement | null>;
	finishNowEventListenerRef: RefObject<() => void>;
	animationInProgress: boolean;
	animationFinished: boolean;
	onAnimationFinished: () => void;
}

const VideoControls = ({
	currentTime,
	duration,
	videoRef,
	finishNowEventListenerRef,
	animationInProgress,
	animationFinished,
	onAnimationFinished,
}: VideoControlsProps) => {
	const timelineRef = useRef<HTMLDivElement>(null);

	const currentTimePercentage = (currentTime / duration) * 100;

	const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (!timelineRef.current || !duration) {
			return;
		}

		const rect = timelineRef.current.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const percentage = x / rect.width;
		const newTime = percentage * duration;

		if (videoRef.current) {
			videoRef.current.currentTime = newTime;
		}
	};

	const handleTimelineStartClick = () => {
		if (videoRef.current) {
			videoRef.current.currentTime = 0;
		}
	};

	const handleTimelineEndClick = () => {
		if (!duration) {
			return;
		}

		if (videoRef.current) {
			videoRef.current.currentTime = duration;
		}
	};

	return (
		<div className="w-[369px] h-[113px]">
			<div className="flex flex-col items-center space-y-3">
				{/* Time and Duration */}
				<div className="text-[23px] font-semibold w-full flex justify-between">
					<div className="text-[#26BF56]">{formatTime(currentTime)}</div>

					<div className="text-[#A9A9A9]">{formatTime(duration)}</div>
				</div>

				{/* Timeline */}
				<div className="w-[369px] relative h-[56px] group flex items-end">
					<div className="absolute bottom-5 pointer-events-none">
						<TicksIcon />
					</div>

					{/* Progress bar */}
					{/* <div
						className="absolute h-full bg-gray-200 dark:bg-gray-600/50 rounded-lg transition-all"
						style={{ width: `${currentTimePercentage}%` }}
					/> */}
					<div className="relative mx-3 w-full">
						<div
							className="w-full bg-[#3A3C43] rounded-[6px] h-[21px] mb-[4px] cursor-pointer"
							ref={timelineRef}
							onClick={handleTimelineClick}
						/>

						{(animationInProgress || animationFinished) && (
							<VideoControlsAnimation
								finishNowEventListenerRef={finishNowEventListenerRef}
								onFinished={onAnimationFinished}
							/>
						)}

						{/* Current time marker */}
						<div
							className="z-10 absolute bottom-[31px] w-0.5 h-full transition-all pointer-events-none"
							style={{ left: `calc(${currentTimePercentage}% - 8px)` }}
						>
							<PlayheadIcon className="" />
							{/* <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-white dark:bg-gray-800 shadow-sm text-xs font-medium">
							{formatTime(currentTime)}
						</div> */}
						</div>
					</div>

					{/* End Caps */}
					<div
						className="absolute left-0 bottom-[4px] border-[4px] rounded-full w-[20px] h-[20px] bg-[#2A2B30] border-[#A9A9A] cursor-pointer"
						onClick={handleTimelineStartClick}
					/>

					<div
						className="absolute right-0 bottom-[4px] border-[4px] rounded-full w-[20px] h-[20px] bg-[#2A2B30] border-[#A9A9A] cursor-pointer"
						onClick={handleTimelineEndClick}
					/>
				</div>
			</div>
		</div>
	);
};

interface VideoControlsAnimationProps {
	finishNowEventListenerRef: RefObject<() => void>;
	onFinished: () => void;
}

const VideoControlsAnimation = ({
	finishNowEventListenerRef,
	onFinished,
}: VideoControlsAnimationProps) => {
	const maxWidth = 345;

	const [sections, setSections] = useState<ReactNode[]>([]);

	const animationTimeMsRef = useRef<number>(2000);

	const animateSection = async (
		i: number,
		sectionsCount: number,
		remainingWidth: number
	) => {
		// Step 2. Generate a random width that's min 10% max 50% of total width remaining per section
		let sectionWidth = 0;
		if (i === sectionsCount - 1) {
			sectionWidth = remainingWidth;
		} else {
			sectionWidth = getRandomInt(
				Math.floor(remainingWidth * 0.1),
				Math.floor(remainingWidth * 0.3)
			);
		}

		// Step 3. Each OTHER "section" should be green or red
		let sectionColor: string;
		let sectionAnimation: string = "cropLeft";

		if (i % 2 === 0) {
			sectionColor = "#26BF56";

			// Step 4. Each green section should have a transition that slowly crops in from left to right
			// sectionAnimation = "cropLeft";
		} else {
			sectionColor = "#FF3939";

			// Step 5. Each red section should pop in and flash
			// sectionAnimation = "pop";
		}

		// Step 6. Each animation should take 1s or so
		const sectionAnimationTime = animationTimeMsRef.current;

		const sectionElement = (
			<div
				key={i}
				className="rounded-full h-full"
				style={{
					width: sectionWidth,
				}}
			>
				<div
					className="h-full rounded-[6px]"
					style={{
						backgroundColor: sectionColor,
						animation: `${sectionAnimation} ${sectionAnimationTime}ms ease-out  forwards`,
					}}
				/>
			</div>
		);

		setSections((prev) => [...prev, sectionElement]);

		await new Promise((resolve) => setTimeout(resolve, sectionAnimationTime));

		return remainingWidth - sectionWidth;
	};

	useEffect(() => {
		setSections([]);

		finishNowEventListenerRef.current = () => {
			// Step 6. If a "finish now" flag is received, set the time for each section remaining to be 0.1s
			animationTimeMsRef.current = 100;
		};

		const animate = async () => {
			// Step 1. Generate a random amount of "sections", min 6 max 12
			const sectionsCount = getRandomInt(8, 12);

			let remainingWidth = maxWidth;
			for (let i = 0; i < sectionsCount; i++) {
				remainingWidth = await animateSection(i, sectionsCount, remainingWidth);
			}

			onFinished();
		};

		animate();
	}, []);

	return (
		<div className="pointer-events-none absolute left-0 right-0 h-[21px] bottom-1 flex items-start justify-start gap-0">
			{...sections}
		</div>
	);
};

export default VideoControls;
