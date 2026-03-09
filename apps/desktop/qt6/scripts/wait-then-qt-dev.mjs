import { spawn, spawnSync } from "node:child_process";
import { request } from "node:http";

import { qt6Dir, resolveQtExecutable } from "./qt6-paths.mjs";

const port = Number(process.env.PORT ?? "5733");
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

async function waitForWebServer() {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const available = await new Promise((resolve) => {
			const req = request(
				{ hostname: "localhost", port, path: "/", method: "GET" },
				() => resolve(true),
			);
			req.on("error", () => resolve(false));
			req.setTimeout(POLL_INTERVAL_MS, () => {
				req.destroy();
				resolve(false);
			});
			req.end();
		});
		if (available) return;
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(
		`Web server on port ${port} did not start within ${TIMEOUT_MS}ms`,
	);
}

await waitForWebServer();

const buildResult = spawnSync("node", ["scripts/cmake-build.mjs"], {
	cwd: qt6Dir,
	env: process.env,
	stdio: "inherit",
});
if (buildResult.status !== 0) process.exit(buildResult.status ?? 1);

const exe = resolveQtExecutable();

const child = spawn(exe, [], {
	cwd: qt6Dir,
	env: process.env,
	stdio: "inherit",
});

child.on("exit", (code) => {
	process.exit(code ?? 0);
});
