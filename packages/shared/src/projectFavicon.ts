const PROJECT_FAVICON_EXTENSIONS = new Set([
	".ico",
	".png",
	".svg",
	".jpg",
	".jpeg",
	".webp",
]);

const STRIP_LEADING_PATH_RE = /^\.?(?:\/|\\)+/;

function toPosixPath(input: string): string {
	return input.replaceAll("\\", "/");
}

function extname(input: string): string {
	const basename = input.slice(input.lastIndexOf("/") + 1);
	const dotIndex = basename.lastIndexOf(".");
	return dotIndex <= 0 ? "" : basename.slice(dotIndex);
}

function basenameWithoutExtension(input: string): string {
	const basename = input.slice(input.lastIndexOf("/") + 1);
	const extension = extname(input);
	return extension.length === 0
		? basename
		: basename.slice(0, basename.length - extension.length);
}

function scorePreferredDirectorySegment(segment: string): number {
	switch (segment) {
		case "public":
		case "static":
			return -3;
		case "app":
		case "assets":
			return -2;
		case "src":
		case "icons":
		case "images":
		case "frontend":
		case "client":
		case "web":
		case "ui":
			return -1;
		default:
			return 0;
	}
}

export function normalizeProjectRelativePath(input: string): string {
	return toPosixPath(input)
		.replace(STRIP_LEADING_PATH_RE, "")
		.replaceAll(/\/+/g, "/")
		.trim();
}

export function isProjectImageFilePath(input: string): boolean {
	const normalized = normalizeProjectRelativePath(input);
	if (normalized.length === 0) return false;
	return PROJECT_FAVICON_EXTENSIONS.has(extname(normalized).toLowerCase());
}

export function isLikelyProjectFaviconPath(input: string): boolean {
	if (!isProjectImageFilePath(input)) return false;

	const basename = basenameWithoutExtension(
		normalizeProjectRelativePath(input).toLowerCase(),
	);
	return (
		basename === "favicon" ||
		basename.startsWith("favicon-") ||
		basename.startsWith("favicon_") ||
		basename.includes("apple-touch-icon") ||
		basename.includes("mask-icon") ||
		basename === "icon" ||
		basename.startsWith("icon-") ||
		basename.startsWith("icon_") ||
		basename === "logo" ||
		basename.startsWith("logo-") ||
		basename.startsWith("logo_")
	);
}

export function getProjectFaviconPathScore(input: string): number {
	const normalized = normalizeProjectRelativePath(input).toLowerCase();
	if (!isProjectImageFilePath(normalized)) {
		return Number.POSITIVE_INFINITY;
	}

	const basename = basenameWithoutExtension(normalized);
	const segments = normalized.split("/");
	const ext = extname(normalized);

	let score = 100;

	if (basename === "favicon") {
		score = 0;
	} else if (
		basename.startsWith("favicon-") ||
		basename.startsWith("favicon_")
	) {
		score = 1;
	} else if (basename.includes("favicon")) {
		score = 2;
	} else if (basename.includes("apple-touch-icon")) {
		score = 3;
	} else if (basename.includes("mask-icon")) {
		score = 4;
	} else if (
		basename === "icon" ||
		basename.startsWith("icon-") ||
		basename.startsWith("icon_")
	) {
		score = 5;
	} else if (basename.includes("icon")) {
		score = 6;
	} else if (
		basename === "logo" ||
		basename.startsWith("logo-") ||
		basename.startsWith("logo_")
	) {
		score = 7;
	} else if (basename.includes("logo")) {
		score = 8;
	} else {
		score = 20;
	}

	for (const segment of segments.slice(0, -1)) {
		score += scorePreferredDirectorySegment(segment);
	}

	score += Math.max(0, segments.length - 1);
	score += normalized.length / 100;

	if (ext === ".svg" || ext === ".ico") {
		score -= 0.25;
	}

	return score;
}

export function compareProjectFaviconPaths(
	left: string,
	right: string,
): number {
	const scoreDelta =
		getProjectFaviconPathScore(left) - getProjectFaviconPathScore(right);
	if (scoreDelta !== 0) return scoreDelta;

	const lengthDelta = left.length - right.length;
	if (lengthDelta !== 0) return lengthDelta;

	return left.localeCompare(right);
}
