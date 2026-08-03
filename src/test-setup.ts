import { vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({ env: import.meta.env }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => undefined)),
}));
