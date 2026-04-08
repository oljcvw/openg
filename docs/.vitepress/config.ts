import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	srcDir: "content",

	cleanUrls: true,

	title: "Open Grind",
	description: "Open Grind project documentation and Grindr API reference",
	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		nav: [
			{ text: "Home", link: "/" },
			{ text: "Grindr API", link: "/grindr-api" },
		],

		search: {
			provider: "local",
		},

		sidebar: {
			"/guide/": [
				{
					text: "User guide",
					items: [{ text: "Download", link: "/guide/download" }],
				},
			],
			"/grindr-api/": [
				{
					text: "Grindr API",
					link: "/",
					base: "/grindr-api",
					items: [
						{ text: "Getting started", link: "/getting-started" },
						{ text: "Security headers", link: "/security-headers" },
						{ text: "API Authorization", link: "/api-authorization" },
						{ text: "Authentication", link: "/authentication" },
						{ text: "Bootstrap", link: "/bootstrap" },
						{
							text: "Messaging",
							link: "/messaging",
							collapsed: true,
							items: [
								{ text: "Conversations", link: "/messaging/conversations" },
								{ text: "Saved phrases", link: "/messaging/saved-phrases" },
								{ text: "Messages", link: "/messaging/messages" },
								{ text: "Albums", link: "/messaging/albums" },
								{ text: "Misc", link: "/messaging/misc" },
							],
						},
						{
							text: "Users",
							link: "/users",
							collapsed: true,
							items: [
								{ text: "Profiles", link: "/users/profiles" },
								{ text: "Favorites", link: "/users/favorites" },
							],
						},
						{ text: "Reports, WIP", link: "/reports" },
						{
							text: "Browse",
							link: "/browse",
							collapsed: true,
							items: [
								{ text: "Location", link: "/browse/location" },
								{ text: "Grid", link: "/browse/grid" },
								{ text: "Social events", link: "/browse/social-events" },
								{ text: "Entitlements", link: "/browse/entitlements" },
								{ text: "Links", link: "/browse/links" },
								{ text: "Travels", link: "/browse/travels" },
								{ text: "Roam, WIP", link: "/browse/roam" },
								{ text: "Age verification", link: "/browse/age-verification" },
								{ text: "Blocks", link: "/browse/blocks" },
								{ text: "Hides", link: "/browse/hides" },
								{ text: "Discover, WIP", link: "/browse/discover" },
							],
						},
						{
							text: "Analytics",
							link: "/analytics",
							collapsed: true,
							items: [
								{ text: "Assignments", link: "/analytics/assignments" },
								{ text: "Trackers", link: "/analytics/trackers" },
							],
						},
						{
							text: "Media",
							link: "/media",
							collapsed: true,
							items: [
								{ text: "Public CDN files", link: "/media/public-cdn-files" },
								{ text: "Signed CDN files", link: "/media/signed-cdn-files" },
							],
						},
						{
							text: "Interest",
							link: "/interest",
							collapsed: true,
							items: [
								{ text: "Views", link: "/interest/views" },
								{ text: "Taps", link: "/interest/taps" },
								{ text: "Alist, WIP", link: "/interest/alist" },
							],
						},
						{ text: "Right Now", link: "/right-now" },
						{
							text: "Settings",
							link: "/settings",
							collapsed: true,
							items: [
								{ text: "Account", link: "/settings/account" },
								{
									text: "SMS verification",
									link: "/settings/sms-verification",
								},
							],
						},
						{
							text: "Third party integrations",
							link: "/third-party-integrations",
							collapsed: true,
							items: [
								{ text: "Spotify", link: "/third-party-integrations/spotify" },
							],
						},
						{ text: "StoreApiRest, WIP", link: "/storeapirest" },
						{ text: "Notifications", link: "/notifications" },
						{ text: "Woodwork, WIP", link: "/woodwork" },
						{ text: "Ratings", link: "/ratings" },
						{ text: "Top Picks, WIP", link: "/top-picks" },
						{ text: "Signal share", link: "/signal-share" },
						{ text: "Drawer, WIP", link: "/drawer" },
						{ text: "Legal agreements, WIP", link: "/legal-agreements" },
						{ text: "GrindrStore, WIP", link: "/grindrstore" },
						{ text: "Heatmap, WIP", link: "/heatmap" },
						{ text: "Reddot, WIP", link: "/reddot" },
						{ text: "Videocalls, WIP", link: "/videocalls" },
						{ text: "Modal, WIP", link: "/modal" },
						{ text: "Warnings, WIP", link: "/warnings" },
						{ text: "Logging, WIP", link: "/logging" },
						{ text: "Rewarded chats, WIP", link: "/rewarded-chats" },
						{ text: "Rewarded ads, WIP", link: "/rewarded-ads" },
						{ text: "Boosting, WIP", link: "/boosting" },
						{ text: "GIFs, WIP", link: "/gifs" },
						{ text: "Access requests, WIP", link: "/access-requests" },
						{ text: "Offers, WIP", link: "/offers" },
						{ text: "VIP, WIP", link: "/vip" },
						{ text: "Rate limits", link: "/rate-limits" },
						{
							text: "WebSocket",
							link: "/websocket",
							collapsed: true,
							items: [
								{ text: "Events", link: "/websocket/events" },
								{
									text: "Notification Event",
									link: "/websocket/notification-event",
								},
								{ text: "Commands", link: "/websocket/commands" },
							],
						},
						{ text: "Appendix", link: "/appendix" },
					],
				},
			],
		},

		socialLinks: [
			{ icon: "git", link: "https://git.hloth.dev/hloth/open-grind/" },
		],

		footer: {
			message: "Open Grind is not affiliated with Grindr in any way.",
			copyright:
				'Licensed under the <a href="https://git.hloth.dev/hloth/open-grind/src/branch/main/LICENSE">MIT</a> License.',
		},
	},
});
