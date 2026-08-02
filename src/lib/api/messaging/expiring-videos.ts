import z from "zod";

import { fetchRest } from "$lib/api";

const expiringVideoStatusSchema = z.object({
	available: z.number().int().nonnegative(),
});

export type ExpiringVideoStatus = z.infer<typeof expiringVideoStatusSchema>;

export async function getExpiringVideoStatus(): Promise<ExpiringVideoStatus> {
	return fetchRest("/v4/videos/expiring/status", { method: "GET" }).then(
		(response) => response.jsonParsed(expiringVideoStatusSchema),
	);
}
