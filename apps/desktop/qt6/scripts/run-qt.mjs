import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { qt6Dir, resolveQtExecutable } from "./qt6-paths.mjs";

const exe = resolveQtExecutable();

if (!existsSync(exe)) {
  console.error("Qt6 app not built. Run: bun run build:qt6");
  process.exit(1);
}

const child = spawn(exe, [], {
  cwd: qt6Dir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
