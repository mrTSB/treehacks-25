const PlayheadIcon = (props: React.SVGAttributes<SVGElement>) => {
	return (
		<svg
			width="16"
			height="56"
			viewBox="0 0 16 56"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path d="M8 31L16 19.9286V1.43051e-06H0V19.9286L8 31Z" fill="#26BF56" />
			<path d="M8 21L12 15.2857V5H4V15.2857L8 21Z" fill="#00581B" />
			<path
				d="M7 28C7 27.4477 7.44772 27 8 27V27C8.55228 27 9 27.4477 9 28V55C9 55.5523 8.55228 56 8 56V56C7.44772 56 7 55.5523 7 55V28Z"
				fill="#26BF56"
			/>
		</svg>
	);
};

export default PlayheadIcon;
