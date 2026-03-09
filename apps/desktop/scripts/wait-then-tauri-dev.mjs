import { spawn } from "node:child_process";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const port = Number(process.env.PORT ?? "5733");
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

async function waitForServer() {
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
		`Server on port ${port} did not start within ${TIMEOUT_MS}ms`,
	);
}

await waitForServer();

const child = spawn("bunx", ["tauri", "dev"], {
	cwd: desktopDir,
	env: process.env,
	stdio: "inherit",
});

child.on("exit", (code) => {
	process.exit(code ?? 0);
});
