"use client";

interface EmptyStateProps {
	handleVideoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const EmptyState = ({ handleVideoUpload }: EmptyStateProps) => {
	return (
		<div className="max-w-2xl mx-auto">
			<div className="border border-dashed  border-[#324136] rounded-[30px] bg-white dark:bg-[#111111] shadow-lg">
				<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
					<input
						type="file"
						accept="video/*"
						onChange={handleVideoUpload}
						className="hidden"
						id="video-upload"
					/>
					<div className="rounded-full bg-gray-100 dark:bg-[#1C1E24] p-3 mb-4">
						<svg
							className="w-8 h-8 text-gray-500 dark:text-[#A9A9A9]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M7 4v16M17 4v16M3 8h18M3 16h18"
							/>
						</svg>
					</div>
					<label
						htmlFor="video-upload"
						className="cursor-pointer inline-flex items-center px-4 py-2.5 bg-[#89BF79] text-black text-sm font-medium rounded-md hover:bg-[#89BF79]/80 transition-colors  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#89BF79]"
					>
						<svg
							className="w-5 h-5 mr-2 -ml-1"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 6v6m0 0v6m0-6h6m-6 0H6"
							/>
						</svg>
						Upload Video
					</label>
					<p className="mt-2 text-sm text-gray-500 dark:text-[#A9A9A9]">
						MP4 files are recommended.
					</p>
				</div>
			</div>
		</div>
	);
};

export default EmptyState;
