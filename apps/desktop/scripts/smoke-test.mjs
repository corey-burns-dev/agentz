import { spawn } from "node:child_process";
import { platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const binName = platform() === "win32" ? "agentz.exe" : "agentz";
const tauriTarget = resolve(desktopDir, "src-tauri/target/release", binName);

console.log("\nLaunching Tauri smoke test...");

const child = spawn(tauriTarget, [], {
	stdio: ["pipe", "pipe", "pipe"],
	env: {
		...process.env,
		VITE_DEV_SERVER_URL: "",
	},
});

let output = "";
child.stdout.on("data", (chunk) => {
	output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
	output += chunk.toString();
});

const timeout = setTimeout(() => {
	child.kill();
}, 8_000);

child.on("exit", () => {
	clearTimeout(timeout);

	const fatalPatterns = [
		"Cannot find module",
		"MODULE_NOT_FOUND",
		"Refused to execute",
		"Uncaught Error",
		"Uncaught TypeError",
		"Uncaught ReferenceError",
	];
	const failures = fatalPatterns.filter((pattern) => output.includes(pattern));

	if (failures.length > 0) {
		console.error("\nDesktop smoke test failed:");
		for (const failure of failures) {
			console.error(` - ${failure}`);
		}
		console.error(`\nFull output:\n${output}`);
		process.exit(1);
	}

	console.log("Desktop smoke test passed.");
	process.exit(0);
});
