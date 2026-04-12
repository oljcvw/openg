<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	let email = $state("");
	let password = $state("");
</script>

<main>
	<form
		class="row"
		onsubmit={async (event) => {
			event.preventDefault();
			const result = await invoke("login", {
				email,
				password,
			});
			console.log(result.profile_id);
		}}
	>
		<input placeholder="Email" bind:value={email} autocomplete="off" />
		<input
			placeholder="Password"
			type="password"
			bind:value={password}
			autocomplete="off"
		/>
		<button type="submit">Login</button>
	</form>
	<button
		onclick={async () => {
			const refreshed = await invoke("refresh_token");
			console.log(refreshed.profile_id);
		}}>Refre</button
	>
</main>
