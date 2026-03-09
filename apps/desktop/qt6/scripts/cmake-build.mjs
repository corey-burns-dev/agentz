import { spawnSync } from "node:child_process";
import { buildDir, qt6Dir, resetBuildDirIfStale } from "./qt6-paths.mjs";

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { cwd: qt6Dir, stdio: "inherit", ...opts });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

resetBuildDirIfStale();

run("cmake", ["-B", buildDir, "-S", qt6Dir]);
run("cmake", ["--build", buildDir]);
