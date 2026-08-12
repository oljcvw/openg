import { getProfiles, type ProfileSummary } from "$lib/api/users/profiles";

type ProfileSummariesLoader = (
	profileIds: number[],
) => Promise<ProfileSummary[]>;

export class ProfileSummariesState {
	summaries = $state(new Map<number, ProfileSummary>());

	#loader: ProfileSummariesLoader;
	#requested = new Set<number>();

	constructor(loader: ProfileSummariesLoader = getProfiles) {
		this.#loader = loader;
	}

	get(profileId: number): ProfileSummary | null {
		return this.summaries.get(profileId) ?? null;
	}

	async load(profileIds: readonly number[]): Promise<void> {
		const pending = [...new Set(profileIds)].filter(
			(profileId) => !this.#requested.has(profileId),
		);
		if (pending.length === 0) return;
		pending.forEach((profileId) => this.#requested.add(profileId));

		try {
			const resolved = await this.#loader(pending);
			const summaries = new Map(this.summaries);
			for (const summary of resolved) {
				summaries.set(summary.profileId, summary);
			}
			this.summaries = summaries;
		} catch (error) {
			pending.forEach((profileId) => this.#requested.delete(profileId));
			console.error("Profile card summary batch failed", error);
		}
	}
}
