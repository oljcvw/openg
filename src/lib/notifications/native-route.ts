import z from "zod";

const nativeNotificationRouteSchema = z.object({
	route: z.string(),
	accountId: z.string().regex(/^[0-9]+$/),
});

const safeNotificationRoute =
	/^(?:\/chat(?:\/[A-Za-z0-9:_-]{1,200})?|\/interest\/taps)$/;

export type NativeNotificationRoute = z.infer<
	typeof nativeNotificationRouteSchema
>;

export function acceptedNativeNotificationRoute(
	payload: unknown,
	activeAccountId: number | null,
): NativeNotificationRoute | null {
	const parsed = nativeNotificationRouteSchema.safeParse(payload);
	if (!parsed.success || activeAccountId === null) return null;
	if (parsed.data.accountId !== String(activeAccountId)) return null;
	if (!safeNotificationRoute.test(parsed.data.route)) return null;
	return parsed.data;
}
