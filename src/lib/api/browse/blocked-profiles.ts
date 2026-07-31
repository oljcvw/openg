import { getBlockedUsers } from "$lib/api/browse/blocks";
import { getProfiles } from "$lib/api/users/profiles";

const PROFILE_BATCH_SIZE = 150;

export type BlockedProfile = Awaited<
	ReturnType<typeof getBlockedUsers>
>[number] & {
	displayName: string | null;
	mediaHash: string | null;
};

export async function getBlockedProfiles(): Promise<BlockedProfile[]> {
	const blocked = await getBlockedUsers();
	const summaries = new Map<
		number,
		{ displayName: string | null; mediaHash: string | null }
	>();

	for (let offset = 0; offset < blocked.length; offset += PROFILE_BATCH_SIZE) {
		const profileIds = blocked
			.slice(offset, offset + PROFILE_BATCH_SIZE)
			.map(({ profileId }) => profileId);
		try {
			const profiles = await getProfiles(profileIds);
			for (const profile of profiles) {
				summaries.set(profile.profileId, {
					displayName: profile.displayName,
					mediaHash:
						profile.profileImageMediaHash ??
						profile.medias[0]?.mediaHash ??
						null,
				});
			}
		} catch {
			console.warn("Failed to enrich a blocked-profile summary batch");
		}
	}

	return blocked.map((profile) => ({
		...profile,
		displayName: summaries.get(profile.profileId)?.displayName ?? null,
		mediaHash: summaries.get(profile.profileId)?.mediaHash ?? null,
	}));
}
