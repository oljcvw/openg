<script lang="ts">
	import { gaymojiMediaUrl, profileMediaUrl } from "$lib/util/media";
	import type {
		GaymojiMessage,
		ProfilePhotoReplyMessage,
		VideoCallMessage,
	} from "$lib/model/messaging/messages";
	import RichMessageCard from "./RichMessageCard.svelte";

	let {
		type,
		body,
	}: {
		type:
			| "Gaymoji"
			| "Generative"
			| "ProfileLink"
			| "ProfilePhotoReply"
			| "VideoCall";
		body: unknown;
	} = $props();

	function profileIdFromBody(value: unknown): string | null {
		if (typeof value !== "object" || value === null) return null;
		const record = value as Record<string, unknown>;
		for (const key of ["profileId", "id"] as const) {
			if (!(key in record)) continue;
			const candidate = record[key];
			if (typeof candidate === "number") {
				if (Number.isSafeInteger(candidate) && candidate >= 0)
					return String(candidate);
				continue;
			}
			if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
				const numeric = Number(candidate);
				if (Number.isSafeInteger(numeric)) return candidate;
			}
		}
		return null;
	}

	function callLabel(result: string | null): string {
		const normalized = result?.replaceAll("_", " ").trim().toLocaleLowerCase();
		const labels: Record<string, string> = {
			busy: "Video call busy",
			cancelled: "Video call cancelled",
			canceled: "Video call cancelled",
			declined: "Video call declined",
			missed: "Missed video call",
			"no answer": "Unanswered video call",
			successful: "Video call completed",
			unanswered: "Unanswered video call",
		};
		return normalized ? (labels[normalized] ?? "Video call") : "Video call";
	}

	const profileId = $derived(profileIdFromBody(body));
</script>

{#if type === "Gaymoji"}
	{@const gaymoji = body as GaymojiMessage["body"]}
	<RichMessageCard title="Gaymoji">
		{#snippet children()}
			<img
				src={gaymojiMediaUrl(gaymoji.imageHash)}
				alt="Gaymoji"
				class="mb-1 size-24 object-contain"
				draggable="false"
			/>
		{/snippet}
	</RichMessageCard>
{:else if type === "ProfilePhotoReply"}
	{@const reply = body as ProfilePhotoReplyMessage["body"]}
	<RichMessageCard title={reply.photoContentReply || "Photo reply"}>
		{#snippet children()}
			<img
				src={profileMediaUrl(reply.imageHash, "thumb")}
				alt="Referenced profile"
				class="mb-2 size-16 rounded-lg object-cover"
				draggable="false"
			/>
		{/snippet}
	</RichMessageCard>
{:else if type === "ProfileLink"}
	<RichMessageCard
		title="Profile shared"
		description={profileId ? "Open profile" : "Profile unavailable"}
		href={profileId ? `/profile/${profileId}` : null}
	/>
{:else if type === "VideoCall"}
	{@const call = body as VideoCallMessage["body"]}
	<RichMessageCard title={callLabel(call.result)} />
{:else}
	<RichMessageCard title="Generated content unavailable" />
{/if}
