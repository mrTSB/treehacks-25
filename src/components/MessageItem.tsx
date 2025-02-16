"use client";

import Image from "next/image";
import ProfilePicture from "@/assets/ProfilePicture.png";
import IdeateIcon from "@/assets/IdeateIcon";
import ArrowRightIcon from "@/assets/ArrowRightIcon";

interface MessageProps {
	message: { text: string; sender: "user" | "ai"; title?: string };
}

const Message = ({ message }: MessageProps) => {
	return (
		<div>
			{message.title && (
				<div className="flex items-center gap-[9px] pb-[16px]">
					<div className="w-[53px] h-[53px] flex-shrink-0 flex items-center justify-center bg-[#89BF79] rounded-[15px]">
						<IdeateIcon className="w-[34px] h-[34px] text-black" />
					</div>

					<div className="flex items-center justify-center h-[52px] bg-[#89BF79] rounded-full text-[#022314] font-medium text-[20px] leading-none pl-[23px] pr-[13px]">
						{message.title}
					</div>
				</div>
			)}

			<div
				className={`flex items-center ${
					message.sender === "user" ? "justify-end" : "justify-start"
				}`}
			>
				{message.sender === "user" && (
					<Image
						className="h-[46px] w-[46px] rounded-[12px] mr-[12px]"
						src={ProfilePicture}
						alt="Profile Picture"
					/>
				)}

				<div
					className={`max-w-[80%] rounded-[37px] px-[16px] py-[16px] min-h-[52px] flex items-center justify-center ${
						message.sender === "user"
							? "text-[#E4E4EA] messageItem"
							: "bg-gray-100 dark:bg-[#313131] text-gray-900 dark:text-[#A9A9A9]"
					}`}
				>
					<div className="text-[20px] font-normal">
						{message.sender !== "user" && (
							<div className="inline w-[38px] h-[38px] pr-[11px]">
								<ArrowRightIcon className="inline w-[22px] h-[18px] mb-1" />
							</div>
						)}
						{message.text}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Message;
