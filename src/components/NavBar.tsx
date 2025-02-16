"use client";

import IdeateIcon from "@/assets/IdeateIcon";
import ProfilePicture from "@/assets/ProfilePicture.png";
import Image from "next/image";

const NavBar = () => {
	return (
		<div className="w-[1392px] justify-between bg-[#111111] rounded-b-[30px] mx-auto flex items-start">
			{/* Left Side */}
			<div className="gap-[11px] flex items-start pl-[37px]">
				<IdeateIcon className="w-[39px] h-[43px] flex-shrink-0 mt-[19px] mb-[24px] text-[#75B16F]" />
				<div className="font-semibold text-[40px] -tracking-[0.8px] leading-none pt-[20px]">
					Spielberg
				</div>
			</div>

			{/* Right Side */}
			<div className="flex gap-[27px] pr-[24px] items-start  pt-[20px]">
				<div className="bg-[#222222] border-[0.5px] border-[#313131] h-[47px] text-[#89BF79] font-medium text-[25px] leading-none items-center justify-center flex rounded-full w-[231px]">
					Treehacks 2025
				</div>

				<Image
					className="h-[46px] w-[46px] rounded-[12px]"
					src={ProfilePicture}
					alt="Profile Picture"
				/>
			</div>
		</div>
	);
};

export default NavBar;