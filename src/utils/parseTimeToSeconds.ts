export const parseTimeToSeconds = (timeStr: string): number => {
	const [hours, minutes, seconds] = timeStr.split(":").map(Number);
	return hours * 3600 + minutes * 60 + seconds;
};
