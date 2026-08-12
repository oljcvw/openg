export function albumMediaLoadError(kind: "image" | "video"): Error {
	// Media URLs can be private or signed. Keep them out of the message and
	// stack/cause because devtools logs and "Copy details" may expose them.
	return new Error(`Failed to load album ${kind}`);
}
