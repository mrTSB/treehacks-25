import type { Config } from "tailwindcss";

export default {
	content: [
		"./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/components/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			colors: {
				background: "var(--background)",
				foreground: "var(--foreground)",
				red: "#FF3939",
				green: "#26BF56",
			},
			animation: {
				gradientHighlight: "gradientHighlight 1s ease-in infinite",
			},
		},
	},
	plugins: [],
} satisfies Config;
