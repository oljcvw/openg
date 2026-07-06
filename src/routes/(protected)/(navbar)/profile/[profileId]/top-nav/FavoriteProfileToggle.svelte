<script lang="ts">
	import { StarIcon } from "phosphor-svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		addFavoriteUser,
		removeFavoriteUser,
	} from "$lib/api/users/favorites";
	import { Button } from "$lib/components/ui/button";

	let {
		profileId,
		isFavorite = $bindable(),
	}: {
		profileId: number;
		isFavorite: boolean;
	} = $props();

	let submitting = $state(false);

	const toggleClick = async () => {
		if (submitting) return;
		submitting = true;
		let previousValue = isFavorite;

		try {
			if (isFavorite) {
				isFavorite = false; // Optimistically update the UI
				await removeFavoriteUser({ profileId });
			} else {
				isFavorite = true;
				await addFavoriteUser({ profileId });
			}
		} catch (error) {
			isFavorite = previousValue;
			console.error(error);
			showErrorToast({
				label: isFavorite
					? "Failed to remove from favorites"
					: "Failed to add to favorites",
				error,
			});
		} finally {
			submitting = false;
		}
	};
</script>

<Button
	size="icon-lg"
	onclick={toggleClick}
	variant="secondary"
	aria-checked={isFavorite}
	role="switch"
	aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
	class="size-12"
	disabled={submitting}
>
	<StarIcon weight={isFavorite ? "fill" : "bold"} class="size-6" />
</Button>
