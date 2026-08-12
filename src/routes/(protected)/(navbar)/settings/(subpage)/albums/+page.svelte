<script lang="ts">
	import {
		ArrowClockwiseIcon,
		DownloadSimpleIcon,
		FolderOpenIcon,
		PlayIcon,
		PlusIcon,
		TrashIcon,
	} from "phosphor-svelte";

	import { AlbumActivationService } from "$lib/albums/album-activation-service";
	import {
		type AlbumPresetImportItem,
		deleteAlbumPreset,
		getAlbumPresetStats,
		importAlbumPreset,
		listAlbumPresets,
		readAlbumActivationJournal,
		snapshotRemoteAlbumPreset,
	} from "$lib/albums/album-preset-store";
	import { showErrorToast } from "$lib/api/error";
	import {
		createAlbum,
		getAlbumContent,
		getAlbumLimits,
		getMyAlbums,
	} from "$lib/api/messaging/albums";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import {
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";
	import {
		pickMultipleMedia,
		readMediaBytes,
	} from "$lib/platform/media-picker";
	import type {
		AlbumActivationJournal,
		AlbumPresetManifest,
	} from "$lib/albums/album-presets";
	import type {
		AlbumStorageLimits,
		MyAlbum,
	} from "$lib/model/messaging/albums";

	let { data }: import("./$types").PageProps = $props();

	let albums = $state<MyAlbum[] | null>(null);
	let limits = $state<AlbumStorageLimits | null>(null);
	let presets = $state<AlbumPresetManifest[] | null>(null);
	let journals = $state<Record<number, AlbumActivationJournal | null>>({});
	let presetBytes = $state(0);
	let error = $state<unknown>(null);
	let creating = $state(false);
	let presetDialogOpen = $state(false);
	let presetName = $state("");
	let importing = $state(false);
	let snapshottingAlbumId = $state<number | null>(null);
	let selectedPreset = $state<AlbumPresetManifest | null>(null);
	let selectedTargetId = $state<number | null>(null);
	let activationDialogOpen = $state(false);
	let activationBusy = $state(false);
	let statusMessage = $state<string | null>(null);
	const activationService = new AlbumActivationService();
	const atLimit = $derived(
		albums !== null && limits !== null && albums.length >= limits.maxAlbums,
	);

	async function load(): Promise<void> {
		error = null;
		try {
			const [nextAlbums, nextLimits, nextPresets, stats] = await Promise.all([
				getMyAlbums(),
				getAlbumLimits(),
				listAlbumPresets(data.ourProfileId),
				getAlbumPresetStats(data.ourProfileId),
			]);
			albums = nextAlbums;
			limits = nextLimits;
			presets = nextPresets;
			presetBytes = stats.byteLength;
			journals = Object.fromEntries(
				await Promise.all(
					nextAlbums.map(
						async (album) =>
							[
								album.albumId,
								await readAlbumActivationJournal(
									data.ourProfileId,
									album.albumId,
								),
							] as const,
					),
				),
			);
		} catch (caught) {
			error = caught;
		}
	}
	void load();

	async function createLiveAlbum(): Promise<void> {
		if (creating || atLimit) return;
		creating = true;
		try {
			const created = await createAlbum({ albumName: null });
			await load();
			await openAppDetail(`/settings/albums/${created.albumId}`);
		} catch (caught) {
			showErrorToast({ label: "Failed to create live album", error: caught });
		} finally {
			creating = false;
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
	}

	async function createSavedSet(): Promise<void> {
		if (importing || limits === null) return;
		const name = presetName.trim();
		if (name === "") return;
		importing = true;
		statusMessage = null;
		try {
			const picked = await pickMultipleMedia("media");
			if (picked.length === 0) return;
			if (picked.length > limits.maxContentItemsPerAlbum)
				throw new Error(
					`This saved set exceeds the current ${limits.maxContentItemsPerAlbum}-item service limit`,
				);
			const videos = picked.filter((item) =>
				item.mimeType?.startsWith("video/"),
			).length;
			if (videos > limits.maxVideosPerAlbum)
				throw new Error(
					`This saved set exceeds the current ${limits.maxVideosPerAlbum}-video service limit`,
				);
			const items = await Promise.all(
				picked.map(async (media) => {
					const supportedMimeType = supportedPresetMimeType(
						media.mimeType ?? "",
					);
					if (supportedMimeType === null)
						throw new Error(
							"A selected saved-set item has an unsupported media type",
						);
					const bytes = await readMediaBytes(media);
					if (bytes.byteLength > limits!.maxContentSizeInBytes)
						throw new Error(
							"A selected item exceeds the current per-item service limit",
						);
					return {
						itemId: crypto.randomUUID(),
						kind: supportedMimeType.startsWith("video/")
							? ("video" as const)
							: ("image" as const),
						mimeType: supportedMimeType,
						bytes,
						width: null,
						height: null,
						durationMs: null,
					};
				}),
			);
			await importAlbumPreset({
				accountId: data.ourProfileId,
				presetId: crypto.randomUUID(),
				name,
				items,
			});
			presetDialogOpen = false;
			presetName = "";
			statusMessage = "Saved set imported and encrypted on this device.";
			await load();
		} catch (caught) {
			showErrorToast({ label: "Failed to create saved set", error: caught });
		} finally {
			importing = false;
		}
	}

	function supportedPresetMimeType(
		value: string,
	): AlbumPresetImportItem["mimeType"] | null {
		if (
			value === "image/jpeg" ||
			value === "image/png" ||
			value === "video/mp4" ||
			value === "video/webm"
		)
			return value;
		return null;
	}

	async function snapshotLiveAlbum(album: MyAlbum): Promise<void> {
		if (snapshottingAlbumId !== null || limits === null) return;
		const maximumBytes = limits.maxContentSizeInBytes;
		snapshottingAlbumId = album.albumId;
		statusMessage = null;
		try {
			const latest = await getAlbumContent(album.albumId);
			const items = latest.content.map((item) => {
				const mimeType = supportedPresetMimeType(item.contentType);
				if (mimeType === null || item.url.length === 0)
					throw new Error(
						"Every live-album item must be available in a supported format before it can be saved",
					);
				return {
					itemId: crypto.randomUUID(),
					kind: mimeType.startsWith("video/")
						? ("video" as const)
						: ("image" as const),
					mimeType,
					sourceUrl: item.url,
					maximumBytes,
					width: null,
					height: null,
					durationMs: null,
				};
			});
			await snapshotRemoteAlbumPreset({
				accountId: data.ourProfileId,
				presetId: crypto.randomUUID(),
				name: `Snapshot — ${latest.albumName ?? "Untitled album"}`,
				items,
			});
			statusMessage =
				"The complete live album was downloaded and encrypted as a saved set.";
			await load();
		} catch (caught) {
			showErrorToast({
				label: "Failed to save live album as a set",
				error: caught,
			});
		} finally {
			snapshottingAlbumId = null;
		}
	}

	function requestActivation(preset: AlbumPresetManifest): void {
		selectedPreset = preset;
		selectedTargetId = albums?.length === 1 ? albums[0]!.albumId : null;
		activationDialogOpen = true;
	}

	async function activateSelected(): Promise<void> {
		if (activationBusy || selectedPreset === null || selectedTargetId === null)
			return;
		activationBusy = true;
		try {
			const journal = await activationService.start({
				accountId: data.ourProfileId,
				targetAlbumId: selectedTargetId,
				preset: selectedPreset,
			});
			statusMessage =
				journal.status === "completed"
					? "Saved-set activation completed and the share list was preserved."
					: "Activation stopped because the live album changed. Review it before continuing.";
			activationDialogOpen = false;
			await load();
		} catch (caught) {
			showErrorToast({ label: "Album activation stopped", error: caught });
			await load();
		} finally {
			activationBusy = false;
		}
	}

	async function continueActivation(
		albumId: number,
		journal: AlbumActivationJournal,
	) {
		const preset = presets?.find(
			(candidate) => candidate.presetId === journal.presetId,
		);
		if (!preset || activationBusy) return;
		activationBusy = true;
		try {
			const next = await activationService.resume(
				data.ourProfileId,
				journal,
				preset,
			);
			statusMessage =
				next.status === "completed"
					? "Saved-set activation completed."
					: "The live album conflicts with the saved activation journal.";
			await load();
		} catch (caught) {
			showErrorToast({ label: "Couldn’t continue activation", error: caught });
		} finally {
			activationBusy = false;
		}
	}

	async function cancelActivation(journal: AlbumActivationJournal) {
		await activationService.cancel(data.ourProfileId, journal);
		statusMessage =
			"Activation cancelled. The live album remains in its current, possibly partial state.";
		await load();
	}

	async function restartActivation(
		albumId: number,
		journal: AlbumActivationJournal,
	): Promise<void> {
		const preset = presets?.find(
			(candidate) => candidate.presetId === journal.presetId,
		);
		if (!preset || activationBusy) return;
		activationBusy = true;
		try {
			const next = await activationService.start({
				accountId: data.ourProfileId,
				targetAlbumId: albumId,
				preset,
			});
			statusMessage =
				next.status === "completed"
					? "Saved-set activation completed from the current live state."
					: "The restarted activation stopped because the live album changed again.";
			await load();
		} catch (caught) {
			showErrorToast({ label: "Couldn’t restart activation", error: caught });
		} finally {
			activationBusy = false;
		}
	}

	async function removePreset(preset: AlbumPresetManifest): Promise<void> {
		if (!confirm(`Delete the local saved set “${preset.name}”?`)) return;
		try {
			await deleteAlbumPreset(data.ourProfileId, preset.presetId);
			await load();
		} catch (caught) {
			showErrorToast({ label: "Failed to delete saved set", error: caught });
		}
	}
</script>

<header class="grid gap-1">
	<h1 class="text-2xl font-semibold">Manage albums</h1>
	<p class="text-sm text-muted-foreground">
		Manage service-hosted albums and durable local saved sets.
	</p>
</header>

<section class="grid gap-2" aria-labelledby="live-albums-heading">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 id="live-albums-heading" class="text-lg font-semibold">
				Live albums
			</h2>
			{#if albums !== null && limits !== null}
				<p class="text-xs text-muted-foreground">
					{albums.length} of {limits.maxAlbums} service slots used
				</p>
			{/if}
		</div>
		<Button
			disabled={creating || atLimit}
			onclick={() => void createLiveAlbum()}
		>
			<PlusIcon />
			{creating ? "Creating…" : "Create live album"}
		</Button>
	</div>
	{#if error !== null}
		<div class="rounded-xl border border-destructive/40 p-3 text-sm">
			Couldn’t load live albums.
			<Button variant="outline" size="sm" onclick={() => void load()}
				>Retry</Button
			>
		</div>
	{:else if albums === null}
		{#each Array(3)}<Skeleton class="h-20 rounded-2xl" />{/each}
	{:else if albums.length === 0}
		<p
			class="rounded-2xl border border-dashed p-5 text-center text-muted-foreground"
		>
			No live albums.
		</p>
	{:else}
		{#each albums as album (album.albumId)}
			<Item.Root variant="outline" class="flex-wrap">
				<Item.Media><FolderOpenIcon weight="fill" /></Item.Media>
				<Item.Content>
					<a
						href="/settings/albums/{album.albumId}"
						class="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						onclick={(event) =>
							interceptAppNavigationClick(event, () =>
								openAppDetail(`/settings/albums/${album.albumId}`),
							)}
					>
						<Item.Title>{album.albumName ?? "Untitled album"}</Item.Title>
						<Item.Description
							>{album.content.length} items · shared with {album.sharedCount}</Item.Description
						>
					</a>
				</Item.Content>
				<Item.Actions>
					<Button
						variant="outline"
						size="sm"
						disabled={snapshottingAlbumId !== null}
						onclick={() => void snapshotLiveAlbum(album)}
					>
						<DownloadSimpleIcon />
						{snapshottingAlbumId === album.albumId ? "Saving…" : "Save as set"}
					</Button>
				</Item.Actions>
			</Item.Root>
			{@const journal = journals[album.albumId]}
			{#if journal?.status === "active"}
				<div
					class="border-warning/40 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm"
				>
					<span class="me-auto"
						>An interrupted activation can be continued or cancelled.</span
					>
					<Button
						size="sm"
						disabled={activationBusy}
						onclick={() => void continueActivation(album.albumId, journal)}
					>
						<ArrowClockwiseIcon /> Continue activation
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={activationBusy}
						onclick={() => void cancelActivation(journal)}>Cancel</Button
					>
				</div>
			{:else if journal?.status === "conflict"}
				<div
					class="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 p-3 text-sm"
				>
					<span class="me-auto"
						>The live album changed outside this activation.</span
					>
					<Button
						size="sm"
						disabled={activationBusy ||
							!presets?.some((preset) => preset.presetId === journal.presetId)}
						onclick={() => void restartActivation(album.albumId, journal)}
					>
						<ArrowClockwiseIcon /> Restart activation from current state
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={activationBusy}
						onclick={() => void cancelActivation(journal)}
					>
						Leave album as-is
					</Button>
				</div>
			{/if}
		{/each}
	{/if}
</section>

<section class="mt-3 grid gap-2" aria-labelledby="saved-sets-heading">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 id="saved-sets-heading" class="text-lg font-semibold">
				Saved album sets
			</h2>
			<p class="text-xs text-muted-foreground">
				Encrypted local presets are not service album slots · {formatBytes(
					presetBytes,
				)} used
			</p>
		</div>
		<Button variant="outline" onclick={() => (presetDialogOpen = true)}>
			<PlusIcon /> Create saved set
		</Button>
	</div>
	<div
		class="rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 text-sm"
		role="note"
	>
		Activating a saved set changes the media in the selected live album.
		Everyone who already has access will see the new contents.
	</div>
	{#if statusMessage}<p role="status" class="text-sm text-muted-foreground">
			{statusMessage}
		</p>{/if}
	{#if presets === null}
		<Skeleton class="h-20 rounded-2xl" />
	{:else if presets.length === 0}
		<p
			class="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground"
		>
			No saved album sets have been imported on this device.
		</p>
	{:else}
		{#each presets as preset (preset.presetId)}
			<div class="flex flex-wrap items-center gap-3 rounded-2xl border p-3">
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{preset.name}</p>
					<p class="text-xs text-muted-foreground">
						{preset.items.length} items · {formatBytes(
							preset.items.reduce((total, item) => total + item.byteLength, 0),
						)}
					</p>
				</div>
				<Button
					size="sm"
					disabled={albums?.length === 0 || activationBusy}
					onclick={() => requestActivation(preset)}
				>
					<PlayIcon /> Activate
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Delete saved set"
					onclick={() => void removePreset(preset)}
				>
					<TrashIcon />
				</Button>
			</div>
		{/each}
	{/if}
</section>

<Dialog.Root bind:open={presetDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Create saved album set</Dialog.Title>
			<Dialog.Description>
				Choose a name, then select local photos or videos. Import completes
				atomically into encrypted, account-scoped storage.
			</Dialog.Description>
		</Dialog.Header>
		<Input
			bind:value={presetName}
			maxlength={120}
			placeholder="Saved set name"
			aria-label="Saved set name"
		/>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (presetDialogOpen = false)}
				>Cancel</Button
			>
			<Button
				disabled={importing || presetName.trim() === ""}
				onclick={() => void createSavedSet()}
			>
				{importing ? "Importing…" : "Choose media"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={activationDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title
				>Activate “{selectedPreset?.name ?? "saved set"}”?</Dialog.Title
			>
			<Dialog.Description>
				Keep the current share list and replace this live album’s contents with
				“{selectedPreset?.name ?? "this set"}”? Everyone with access will see
				the new media. During activation they may briefly see partial contents.
				Network or moderation failures can stop the change partway, but the app
				can resume it.
			</Dialog.Description>
		</Dialog.Header>
		{#if albums !== null && albums.length > 1}
			<label class="grid gap-1 text-sm font-medium">
				Target live album
				<select
					bind:value={selectedTargetId}
					class="h-11 rounded-lg border bg-background px-3"
				>
					<option value={null}>Choose an album</option>
					{#each albums as album (album.albumId)}
						<option value={album.albumId}
							>{album.albumName ?? "Untitled album"}</option
						>
					{/each}
				</select>
			</label>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (activationDialogOpen = false)}
				>Leave album as-is</Button
			>
			<Button
				disabled={selectedTargetId === null || activationBusy}
				onclick={() => void activateSelected()}
			>
				{activationBusy ? "Activating…" : "Keep shares and activate"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
