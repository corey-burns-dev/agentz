import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const srcTauriDir = join(desktopDir, "src-tauri");
const targetDir = join(srcTauriDir, "target");

const command = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/run-tauri.mjs <dev|build|run> [...args]");
  process.exit(1);
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function hasStaleTauriPermissionCache() {
  const buildDir = join(targetDir, "debug", "build");
  const permissionFiles = walkFiles(buildDir).filter(
    (filePath) =>
      filePath.endsWith("tauri-core-app-permission-files") ||
      filePath.endsWith("tauri-core-permission-files"),
  );

  for (const filePath of permissionFiles) {
    const contents = readFileSync(filePath, "utf8");
    if (
      contents.includes("/apps/desktop/src-tauri/") &&
      !contents.includes("/apps/desktop/tauri/src-tauri/")
    ) {
      return true;
    }
  }

  return false;
}

function runOrExit(cmd, args, options) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function mergeObjects(baseValue, patchValue) {
  if (
    baseValue &&
    patchValue &&
    typeof baseValue === "object" &&
    typeof patchValue === "object" &&
    !Array.isArray(baseValue) &&
    !Array.isArray(patchValue)
  ) {
    const output = { ...baseValue };
    for (const [key, value] of Object.entries(patchValue)) {
      if (value === null) {
        delete output[key];
        continue;
      }
      output[key] = mergeObjects(output[key], value);
    }
    return output;
  }

  return patchValue;
}

function createEnv() {
  if (command !== "dev") {
    return process.env;
  }

  const currentConfig = process.env.TAURI_CONFIG ? JSON.parse(process.env.TAURI_CONFIG) : {};

  const patchedConfig = mergeObjects(currentConfig, {
    bundle: {
      resources: null,
    },
  });

  return {
    ...process.env,
    TAURI_CONFIG: JSON.stringify(patchedConfig),
  };
}

if (hasStaleTauriPermissionCache()) {
  console.warn("[tauri] stale cached permission paths detected; cleaning Rust build artifacts");
  runOrExit("cargo", ["clean"], { cwd: srcTauriDir });
}

runOrExit("bunx", ["tauri", command, ...extraArgs], {
  cwd: desktopDir,
  env: createEnv(),
});
