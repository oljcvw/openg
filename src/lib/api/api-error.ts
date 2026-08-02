export type ApiErrorKind =
	| "Http"
	| "Auth"
	| "Api"
	| "Unauthorized"
	| "Banned"
	| "RateLimited"
	| "RequestBlocked"
	| "RequestCooldown"
	| "NotInitialized";

export class ApiError extends Error {
	readonly request: {
		method: string;
		path: string;
		body?: unknown;
	};
	readonly response: {
		status: number;
		body: string;
	} | null;
	readonly kind: ApiErrorKind | null;

	constructor(options: {
		message: string;
		request: { method: string; path: string; body?: unknown };
		response?: { status: number; body: string } | null;
		kind?: ApiErrorKind | null;
		cause?: unknown;
	}) {
		super(options.message, { cause: options.cause });
		this.name = "ApiError";
		this.request = options.request;
		this.response = options.response ?? null;
		this.kind = options.kind ?? null;
	}

	get retryable(): boolean {
		if (this.kind === "Http") return true;
		if (this.kind === "Auth" || this.kind === "Unauthorized") return true;
		if (this.response !== null) {
			const { status } = this.response;
			if (status >= 500) return true;
			if (status === 401 || status === 408 || status === 429) return true;
		}
		return false;
	}

	copyableText(): string {
		if (this.kind === "RequestBlocked" || this.kind === "RequestCooldown") {
			return JSON.stringify(
				{
					error: this.message,
					kind: this.kind,
					request: {
						method: this.request.method,
						route: sanitizedRoute(this.request.path),
					},
					status: this.response?.status ?? null,
				},
				null,
				2,
			);
		}
		return JSON.stringify(
			{
				error: this.message,
				kind: this.kind,
				request: this.request,
				response: this.response,
			},
			null,
			2,
		);
	}
}

function sanitizedRoute(path: string): string {
	const [pathname, query = ""] = path.split("?", 2);
	const route = pathname
		.split("/")
		.map((segment) => {
			if (!segment) return segment;
			if (/^\d+$/.test(segment)) return "<id>";
			if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return "<id>";
			return /^[a-z0-9._-]{1,32}$/i.test(segment) ? segment : "<id>";
		})
		.join("/");
	const keys = query
		.split("&")
		.map((part) => part.split("=", 1)[0])
		.filter((key) => /^[a-z0-9_-]{1,32}$/i.test(key))
		.sort();
	return keys.length > 0 ? `${route}?${[...new Set(keys)].join("&")}` : route;
}
