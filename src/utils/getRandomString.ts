export const getRandomString = () => {
	return btoa(Math.random().toString()).slice(3, 15);
};
