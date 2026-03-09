import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const qt6Dir = join(__dirname, "..");
export const buildDir = join(qt6Dir, "build");
const cacheFile = join(buildDir, "CMakeCache.txt");

function readCacheValue(cacheContents, key) {
	const pattern = new RegExp(`^${key}:[^=]*=(.*)$`, "m");
	return pattern.exec(cacheContents)?.[1]?.trim() ?? null;
}

export function resetBuildDirIfStale() {
	if (!existsSync(cacheFile)) return;

	const cacheContents = readFileSync(cacheFile, "utf8");
	const expectedSourceDir = resolve(qt6Dir);
	const expectedBuildDir = resolve(buildDir);
	const cachedSourceDir = readCacheValue(cacheContents, "CMAKE_HOME_DIRECTORY");
	const cachedBuildDir = readCacheValue(cacheContents, "CMAKE_CACHEFILE_DIR");

	if (
		cachedSourceDir &&
		cachedBuildDir &&
		resolve(cachedSourceDir) === expectedSourceDir &&
		resolve(cachedBuildDir) === expectedBuildDir
	) {
		return;
	}

	console.warn(
		"[qt6] Removing stale CMake cache from build/ because the source or build directory changed.",
	);
	rmSync(buildDir, { force: true, recursive: true });
}

export function resolveQtExecutable() {
	let exe = join(buildDir, "agents_qt6");
	if (process.platform === "win32") {
		exe += ".exe";
		if (!existsSync(exe)) {
			const releaseExe = join(buildDir, "Release", "agents_qt6.exe");
			if (existsSync(releaseExe)) return releaseExe;
		}
	}

	return exe;
}
