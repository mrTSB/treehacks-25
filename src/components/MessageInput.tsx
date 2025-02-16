"use client";

import { IoIosColorWand } from "react-icons/io";
import { FaArrowLeft } from "react-icons/fa";

interface MessageInputProps {
	handleSendMessage: (event: React.FormEvent) => Promise<void>;
	newMessage: string;
	setNewMessage: React.Dispatch<React.SetStateAction<string>>;
	handleViralize: () => void;
	handleExport: () => void;
}

const MessageInput = ({
	handleSendMessage,
	newMessage,
	setNewMessage,
	handleViralize,
	handleExport,
}: MessageInputProps) => {
	return (
		<div>
			<form onSubmit={handleSendMessage}>
				<div className="flex space-x-2 px-[92px] absolute bottom-0 right-0 left-0 messageInput bg-transparent">
					<input
						type="text"
						value={newMessage}
						onChange={(e) => setNewMessage(e.target.value)}
						placeholder="Ask Spielberg to make a change..."
						className="flex-1 bg-gray-100/60 dark:bg-[#1C1E24]/60 border-t-[2px] border-l-[2px] border-r-[2px] border-gray-300 dark:border-[#324136] rounded-t-[30px] text-[23px] font-medium focus:outline-none focus:ring-2 focus:ring-[#89BF79] dark:focus:ring-[#89BF79] text-gray-900 dark:text-white pb-[28px] px-[34px] h-[119px] caret-[#89BF79] messageInputField"
					/>


					<button
						type="submit"
						className="hidden px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
					>
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
							/>
						</svg>
					</button>
				</div>
			</form>
			<div className="flex w-full justify-center gap-3 mt-4 absolute bottom-0">
				<button 
					onClick={handleViralize}
					className="bg-[#617d59] hover:bg-[#2C2E34] text-white px-4 py-2 rounded-full flex items-center gap-2 transition-colors"
				>
					<IoIosColorWand /> Viralize
				</button>
				<button 
					onClick={handleExport}
					className="bg-[#3e5535] hover:bg-[#2C2E34] text-white px-4 py-2 rounded-full flex items-center gap-2 transition-colors"
				>
					<FaArrowLeft />Export
				</button>
				</div>
		</div>
	);
};

export default MessageInput;
