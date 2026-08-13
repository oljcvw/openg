import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { grindrApiReference } from "../lib";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	srcDir: "content",

	vite: {
		resolve: {
			alias: {
				$lib: fileURLToPath(new URL("../lib", import.meta.url)),
			},
		},
	},

	cleanUrls: true,

	rewrites: {
		"generated/:path*": ":path*",
	},

	title: "Open Grind",
	description: "Open Grind project documentation and Grindr API reference",
	head: [["link", { rel: "icon", href: "/logo.svg" }]],

	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config

		logo: "/logo.svg",

		nav: [
			{ text: "Home", link: "/" },
			{ text: "User guide", link: "/guides/" },
			{ text: "Developer guide", link: "/development/" },
			{ text: "Grindr API", link: "/grindr-api" },
		],

		search: {
			provider: "local",
		},

		sidebar: {
			"/guides/": [
				{
					text: "User guide",
					items: [
						{ text: "Start here", link: "/guides/" },
						{ text: "Download", link: "/guides/download" },
						{
							text: "Sign in with Google",
							link: "/guides/sign-in-with-google",
						},
						{ text: "Using Open Grind", link: "/guides/using-open-grind" },
						{
							text: "Account, privacy, and settings",
							link: "/guides/account-privacy-settings",
						},
						{
							text: "Platform support",
							link: "/guides/platform-support",
						},
						{
							text: "Troubleshooting",
							link: "/guides/troubleshooting",
						},
						{ text: "FAQ", link: "/guides/faq" },
					],
				},
			],
			"/development/": [
				{
					text: "Developer guide",
					items: [
						{ text: "Overview", link: "/development/" },
						{ text: "Tauri architecture", link: "/development/architecture" },
						{ text: "Platform tracks", link: "/development/platform-tracks" },
						{
							text: "iOS development and release",
							link: "/development/ios-release",
						},
						{ text: "Development workflow", link: "/development/workflow" },
					],
				},
			],
			"/grindr-api/": [
				{
					text: "Grindr API",
					link: "/grindr-api/",
					items: grindrApiReference,
				},
			],
		},

		socialLinks: [
			{ icon: "git", link: "https://git.opengrind.org/open-grind/open-grind/" },
		],

		footer: {
			message: "Open Grind is not affiliated with Grindr in any way.",
			copyright:
				'Licensed under the <a href="https://opengrind.org/license">MIT</a> License.',
		},
	},
});
