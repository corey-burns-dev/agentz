import { describe, expect, it } from "vitest";

import {
  formatClaudeCodeCliUpgradeMessage,
  isClaudeCodeCliVersionSupported,
  MINIMUM_CLAUDE_CODE_CLI_VERSION,
  parseClaudeCodeCliVersion,
} from "./claudeCodeCliVersion.ts";

describe("claudeCodeCliVersion", () => {
  describe("parseClaudeCodeCliVersion", () => {
    it("extracts first semver-like segment from output", () => {
      expect(parseClaudeCodeCliVersion("1.2.3")).toBe("1.2.3");
      expect(parseClaudeCodeCliVersion("version 2.0.0")).toBe("2.0.0");
      expect(parseClaudeCodeCliVersion("@anthropic-ai/claude-code@2.0.0")).toBe("2.0.0");
    });

    it("handles two-part versions by normalizing to three parts", () => {
      const v = parseClaudeCodeCliVersion("2.0");
      expect(v).toBe("2.0.0");
    });

    it("returns null when no valid version found", () => {
      expect(parseClaudeCodeCliVersion("")).toBeNull();
      expect(parseClaudeCodeCliVersion("no version here")).toBeNull();
    });
  });

  describe("isClaudeCodeCliVersionSupported", () => {
    it("returns true for minimum and above", () => {
      expect(isClaudeCodeCliVersionSupported(MINIMUM_CLAUDE_CODE_CLI_VERSION)).toBe(true);
      expect(isClaudeCodeCliVersionSupported("2.0.1")).toBe(true);
      expect(isClaudeCodeCliVersionSupported("2.1.0")).toBe(true);
      expect(isClaudeCodeCliVersionSupported("3.0.0")).toBe(true);
    });

    it("returns false for below minimum", () => {
      expect(isClaudeCodeCliVersionSupported("1.9.9")).toBe(false);
      expect(isClaudeCodeCliVersionSupported("1.0.0")).toBe(false);
      expect(isClaudeCodeCliVersionSupported("0.1.0")).toBe(false);
    });
  });

  describe("formatClaudeCodeCliUpgradeMessage", () => {
    it("includes version when provided", () => {
      const msg = formatClaudeCodeCliUpgradeMessage("1.0.0");
      expect(msg).toContain("v1.0.0");
      expect(msg).toContain(MINIMUM_CLAUDE_CODE_CLI_VERSION);
      expect(msg).toContain("npm install -g @anthropic-ai/claude-code");
    });

    it("uses 'the installed version' when version is null", () => {
      const msg = formatClaudeCodeCliUpgradeMessage(null);
      expect(msg).toContain("the installed version");
      expect(msg).not.toContain("vnull");
    });
  });
});
