import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import {
	compareProjectFaviconPaths,
	isLikelyProjectFaviconPath,
	isProjectImageFilePath,
	normalizeProjectRelativePath,
} from "@agents/shared/projectFavicon";

const FAVICON_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webp": "image/webp",
};

const FALLBACK_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;

const NESTED_APP_DIRECTORIES = ["frontend", "client", "web", "ui"];
const RECURSIVE_SCAN_IGNORED_DIRECTORIES = new Set([
	".git",
	".cache",
	".next",
	".turbo",
	"node_modules",
	"dist",
	"build",
	"out",
]);
const FAVICON_CACHE_TTL_MS = 60_000;

const faviconResolutionCache = new Map<
	string,
	{ resolvedAt: number; filePath: string | null }
>();

const FAVICON_CANDIDATES = [
	"favicon.svg",
	"favicon.ico",
	"favicon.png",
	"public/favicon.svg",
	"public/favicon.ico",
	"public/favicon.png",
	"app/favicon.ico",
	"app/favicon.png",
	"app/icon.svg",
	"app/icon.png",
	"app/icon.ico",
	"src/favicon.ico",
	"src/favicon.svg",
	"src/app/favicon.ico",
	"src/app/icon.svg",
	"src/app/icon.png",
	"assets/icon.svg",
	"assets/icon.png",
	"assets/logo.svg",
	"assets/logo.png",
];

const ICON_SOURCE_FILES = [
	"index.html",
	"public/index.html",
	"app/layout.tsx",
	"src/app/layout.tsx",
	"app/routes/__root.tsx",
	"src/routes/__root.tsx",
	"app/root.tsx",
	"src/root.tsx",
	"src/index.html",
];

const LINK_ICON_HTML_RE =
	/<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon|apple-touch-icon|mask-icon)["'])(?=[^>]*\bhref=["']([^"'#?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE =
	/(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon|apple-touch-icon|mask-icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'#?]+))[^}]*/i;

function extractIconHref(source: string): string | null {
	const htmlMatch = source.match(LINK_ICON_HTML_RE);
	if (htmlMatch?.[1]) return htmlMatch[1];
	const objMatch = source.match(LINK_ICON_OBJ_RE);
	if (objMatch?.[1]) return objMatch[1];
	return null;
}

function buildAppRoots(projectCwd: string): string[] {
	return [
		projectCwd,
		...NESTED_APP_DIRECTORIES.map((directory) =>
			path.join(projectCwd, directory),
		),
	];
}

function isPathWithinProject(
	projectCwd: string,
	candidatePath: string,
): boolean {
	const relative = path.relative(
		path.resolve(projectCwd),
		path.resolve(candidatePath),
	);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function resolveIconHref(
	projectCwd: string,
	appRoot: string,
	sourceFile: string,
	href: string,
): string[] {
	const cleanHref = href.trim();
	if (
		cleanHref.length === 0 ||
		cleanHref.startsWith("data:") ||
		/^[a-z]+:/i.test(cleanHref)
	) {
		return [];
	}

	const normalizedHref = normalizeProjectRelativePath(cleanHref);
	const fromSourceDir = path.join(path.dirname(sourceFile), normalizedHref);
	const candidates = cleanHref.startsWith("/")
		? [
				path.join(appRoot, "public", normalizedHref),
				path.join(appRoot, normalizedHref),
			]
		: [
				fromSourceDir,
				path.join(appRoot, normalizedHref),
				path.join(appRoot, "public", normalizedHref),
			];

	return [...new Set(candidates)].filter((candidate) =>
		isPathWithinProject(projectCwd, candidate),
	);
}

async function resolveExistingFile(
	projectCwd: string,
	candidatePath: string,
): Promise<string | null> {
	if (!isPathWithinProject(projectCwd, candidatePath)) {
		return null;
	}
	try {
		const stats = await fs.stat(candidatePath);
		return stats.isFile() ? candidatePath : null;
	} catch {
		return null;
	}
}

async function findWellKnownProjectFavicon(
	projectCwd: string,
): Promise<string | null> {
	for (const appRoot of buildAppRoots(projectCwd)) {
		for (const candidate of FAVICON_CANDIDATES) {
			const resolved = await resolveExistingFile(
				projectCwd,
				path.join(appRoot, candidate),
			);
			if (resolved) return resolved;
		}

		for (const sourceFileRelativePath of ICON_SOURCE_FILES) {
			const sourceFile = path.join(appRoot, sourceFileRelativePath);
			let source: string;
			try {
				source = await fs.readFile(sourceFile, "utf8");
			} catch {
				continue;
			}
			const href = extractIconHref(source);
			if (!href) continue;

			for (const resolvedPath of resolveIconHref(
				projectCwd,
				appRoot,
				sourceFile,
				href,
			)) {
				const resolved = await resolveExistingFile(projectCwd, resolvedPath);
				if (resolved) return resolved;
			}
		}
	}

	return null;
}

async function findRecursiveProjectFavicon(
	projectCwd: string,
): Promise<string | null> {
	const pendingDirectories = [projectCwd];
	let bestLikelyMatch: { relativePath: string; absolutePath: string } | null =
		null;
	let bestImageMatch: { relativePath: string; absolutePath: string } | null =
		null;

	while (pendingDirectories.length > 0) {
		const currentDirectory = pendingDirectories.shift();
		if (!currentDirectory) break;

		const dirents = await fs
			.readdir(currentDirectory, {
				encoding: "utf8",
				withFileTypes: true,
			})
			.catch(() => null);
		if (!dirents) {
			continue;
		}

		dirents.sort((left, right) => left.name.localeCompare(right.name));

		for (const dirent of dirents) {
			if (!dirent.name || dirent.name === "." || dirent.name === "..") {
				continue;
			}

			const absolutePath = path.join(currentDirectory, dirent.name);
			if (!isPathWithinProject(projectCwd, absolutePath)) {
				continue;
			}

			if (dirent.isDirectory()) {
				if (!RECURSIVE_SCAN_IGNORED_DIRECTORIES.has(dirent.name)) {
					pendingDirectories.push(absolutePath);
				}
				continue;
			}

			if (!dirent.isFile()) {
				continue;
			}

			const relativePath = normalizeProjectRelativePath(
				path.relative(projectCwd, absolutePath),
			);
			if (!isProjectImageFilePath(relativePath)) {
				continue;
			}

			if (
				bestImageMatch === null ||
				compareProjectFaviconPaths(relativePath, bestImageMatch.relativePath) <
					0
			) {
				bestImageMatch = { relativePath, absolutePath };
			}

			if (!isLikelyProjectFaviconPath(relativePath)) {
				continue;
			}

			if (
				bestLikelyMatch === null ||
				compareProjectFaviconPaths(relativePath, bestLikelyMatch.relativePath) <
					0
			) {
				bestLikelyMatch = { relativePath, absolutePath };
			}

			if (compareProjectFaviconPaths(relativePath, "public/favicon.svg") <= 0) {
				return absolutePath;
			}
		}
	}

	return bestLikelyMatch?.absolutePath ?? bestImageMatch?.absolutePath ?? null;
}

async function resolveProjectFavicon(
	projectCwd: string,
): Promise<string | null> {
	const cached = faviconResolutionCache.get(projectCwd);
	if (cached && Date.now() - cached.resolvedAt < FAVICON_CACHE_TTL_MS) {
		return cached.filePath;
	}

	const wellKnown = await findWellKnownProjectFavicon(projectCwd);
	const filePath = wellKnown ?? (await findRecursiveProjectFavicon(projectCwd));
	faviconResolutionCache.set(projectCwd, {
		resolvedAt: Date.now(),
		filePath,
	});
	return filePath;
}

async function serveFaviconFile(
	filePath: string,
	res: http.ServerResponse,
): Promise<void> {
	const ext = path.extname(filePath).toLowerCase();
	const contentType = FAVICON_MIME_TYPES[ext] ?? "application/octet-stream";
	const data = await fs.readFile(filePath);
	res.writeHead(200, {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=3600",
	});
	res.end(data);
}

function serveFallbackFavicon(res: http.ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "image/svg+xml",
		"Cache-Control": "public, max-age=3600",
	});
	res.end(FALLBACK_FAVICON_SVG);
}

async function handleProjectFaviconRequest(
	url: URL,
	res: http.ServerResponse,
): Promise<void> {
	const projectCwd = url.searchParams.get("cwd");
	if (!projectCwd) {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end("Missing cwd parameter");
		return;
	}

	const requestedRelativePath = url.searchParams.get("relativePath");
	if (requestedRelativePath) {
		const normalizedPath = normalizeProjectRelativePath(requestedRelativePath);
		const resolved = await resolveExistingFile(
			projectCwd,
			path.join(projectCwd, normalizedPath),
		);
		if (!resolved) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Favicon not found");
			return;
		}
		await serveFaviconFile(resolved, res);
		return;
	}

	const resolvedFavicon = await resolveProjectFavicon(projectCwd);
	if (!resolvedFavicon) {
		serveFallbackFavicon(res);
		return;
	}

	await serveFaviconFile(resolvedFavicon, res);
}

export function tryHandleProjectFaviconRequest(
	url: URL,
	res: http.ServerResponse,
): boolean {
	if (url.pathname !== "/api/project-favicon") {
		return false;
	}

	void handleProjectFaviconRequest(url, res).catch((error) => {
		console.error("Failed to resolve project favicon", {
			projectCwd: url.searchParams.get("cwd"),
			relativePath: url.searchParams.get("relativePath"),
			error,
		});
		if (res.headersSent) {
			res.end();
			return;
		}
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.end("Favicon resolution failed");
	});

	return true;
}
