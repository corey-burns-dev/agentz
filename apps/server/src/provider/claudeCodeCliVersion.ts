const CLAUDE_VERSION_PATTERN = /(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/;

export const MINIMUM_CLAUDE_CODE_CLI_VERSION = "2.0.0";

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: ReadonlyArray<string>;
}

function normalizeVersion(version: string): string {
  const [main, prerelease] = version.trim().split("-", 2);
  const segments = (main ?? "")
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 2) {
    segments.push("0");
  }

  return prerelease ? `${segments.join(".")}-${prerelease}` : segments.join(".");
}

function parseSemver(version: string): ParsedSemver | null {
  const normalized = normalizeVersion(version);
  const [main = "", prerelease] = normalized.split("-", 2);
  const segments = main.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [majorSegment, minorSegment, patchSegment] = segments;
  if (!majorSegment || !minorSegment || !patchSegment) {
    return null;
  }

  const major = Number.parseInt(majorSegment, 10);
  const minor = Number.parseInt(minorSegment, 10);
  const patch = Number.parseInt(patchSegment, 10);
  if (![major, minor, patch].every(Number.isInteger)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease:
      prerelease
        ?.split(".")
        .map((s) => s.trim())
        .filter((s) => s.length > 0) ?? [],
  };
}

function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }
  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }
  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }
  if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length === 0) {
    return 0;
  }
  if (parsedLeft.prerelease.length === 0) return 1;
  if (parsedRight.prerelease.length === 0) return -1;
  return 0;
}

export function parseClaudeCodeCliVersion(output: string): string | null {
  const match = CLAUDE_VERSION_PATTERN.exec(output);
  if (!match?.[1]) {
    return null;
  }
  const parsed = parseSemver(match[1]);
  if (!parsed) {
    return null;
  }
  return normalizeVersion(match[1]);
}

export function isClaudeCodeCliVersionSupported(version: string): boolean {
  return compareSemver(version, MINIMUM_CLAUDE_CODE_CLI_VERSION) >= 0;
}

export function formatClaudeCodeCliUpgradeMessage(version: string | null): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Claude Code CLI ${versionLabel} is below the minimum required version (${MINIMUM_CLAUDE_CODE_CLI_VERSION}). Please update: npm install -g @anthropic-ai/claude-code`;
}
