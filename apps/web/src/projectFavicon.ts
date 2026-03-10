import { normalizeProjectRelativePath } from "@agents/shared/projectFavicon";

function getServerHttpOrigin(): string {
	if (typeof window === "undefined") return "";

	const bridgeUrl = window.desktopBridge?.getWsUrl?.();
	const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
	const wsUrl =
		bridgeUrl && bridgeUrl.length > 0
			? bridgeUrl
			: envUrl && envUrl.length > 0
				? envUrl
				: `ws://${window.location.hostname}:${window.location.port}`;
	const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

	try {
		return new URL(httpUrl).origin;
	} catch {
		return httpUrl;
	}
}

export function buildProjectFaviconUrl(input: {
	cwd: string;
	relativePath?: string | null;
}): string {
	const baseOrigin =
		getServerHttpOrigin() ||
		(typeof window !== "undefined"
			? window.location.origin
			: "http://localhost");
	const url = new URL("/api/project-favicon", baseOrigin);
	url.searchParams.set("cwd", input.cwd);
	if (input.relativePath) {
		url.searchParams.set(
			"relativePath",
			normalizeProjectRelativePath(input.relativePath),
		);
	}
	return url.toString();
}
