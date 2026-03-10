import { describe, expect, it } from "vitest";

import {
  asArray,
  asObject,
  asString,
  buildControlAllowResponse,
  buildControlBlockResponse,
  buildControlInitializeMessage,
  buildPermissionFlags,
  CLAUDE_CODE_DEFAULT_MODEL,
  CLAUDE_CODE_OPUS_MODEL,
  CLAUDE_CODE_SDK_VERSION,
  classifyClaudeCodeStderrLine,
  detailFromToolInput,
  itemTypeFromToolName,
  normalizeClaudeCodeModelSlug,
  pathFromToolInput,
  requestKindFromToolName,
} from "./claudeCodeAppServerHelpers.ts";

describe("claudeCodeAppServerHelpers", () => {
  describe("normalizeClaudeCodeModelSlug", () => {
    it("returns undefined for empty or null", () => {
      expect(normalizeClaudeCodeModelSlug(undefined)).toBeUndefined();
      expect(normalizeClaudeCodeModelSlug(null)).toBeUndefined();
      expect(normalizeClaudeCodeModelSlug("")).toBeUndefined();
      expect(normalizeClaudeCodeModelSlug("   ")).toBeUndefined();
    });

    it("returns trimmed slug for non-empty input", () => {
      expect(normalizeClaudeCodeModelSlug("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
      expect(normalizeClaudeCodeModelSlug("  claude-opus  ")).toBe("claude-opus");
    });
  });

  describe("buildPermissionFlags", () => {
    it("returns --dangerously-skip-permissions for full-access", () => {
      expect(buildPermissionFlags("full-access")).toEqual(["--dangerously-skip-permissions"]);
    });

    it("returns empty array for approval-required", () => {
      expect(buildPermissionFlags("approval-required")).toEqual([]);
    });
  });

  describe("itemTypeFromToolName", () => {
    it("maps Bash to commandExecution", () => {
      expect(itemTypeFromToolName("Bash")).toBe("commandExecution");
    });

    it("maps file-change tools to fileChange", () => {
      expect(itemTypeFromToolName("Write")).toBe("fileChange");
      expect(itemTypeFromToolName("Edit")).toBe("fileChange");
      expect(itemTypeFromToolName("MultiEdit")).toBe("fileChange");
      expect(itemTypeFromToolName("NotebookEdit")).toBe("fileChange");
    });

    it("maps file-read tools to dynamicToolCall", () => {
      expect(itemTypeFromToolName("Read")).toBe("dynamicToolCall");
      expect(itemTypeFromToolName("Glob")).toBe("dynamicToolCall");
      expect(itemTypeFromToolName("Grep")).toBe("dynamicToolCall");
      expect(itemTypeFromToolName("LS")).toBe("dynamicToolCall");
    });

    it("maps mcp__ prefixed to dynamicToolCall", () => {
      expect(itemTypeFromToolName("mcp__foo")).toBe("dynamicToolCall");
    });

    it("maps unknown tools to dynamicToolCall", () => {
      expect(itemTypeFromToolName("CustomTool")).toBe("dynamicToolCall");
    });
  });

  describe("requestKindFromToolName", () => {
    it("maps Bash to command", () => {
      expect(requestKindFromToolName("Bash")).toBe("command");
    });
    it("maps file-change tools to file-change", () => {
      expect(requestKindFromToolName("Write")).toBe("file-change");
    });
    it("maps file-read tools to file-read", () => {
      expect(requestKindFromToolName("Read")).toBe("file-read");
    });
    it("maps unknown to command", () => {
      expect(requestKindFromToolName("Other")).toBe("command");
    });
  });

  describe("detailFromToolInput", () => {
    it("returns command for Bash input", () => {
      expect(detailFromToolInput("Bash", { command: "ls -la" })).toBe("ls -la");
      expect(detailFromToolInput("Bash", { command: "  echo hi  " })).toBe("echo hi");
      expect(detailFromToolInput("Bash", {})).toBeUndefined();
      expect(detailFromToolInput("Bash", { command: 123 })).toBeUndefined();
    });

    it("returns path for file tools (file_path or path)", () => {
      expect(detailFromToolInput("Read", { file_path: "/tmp/foo" })).toBe("/tmp/foo");
      expect(detailFromToolInput("Write", { path: "src/index.ts" })).toBe("src/index.ts");
      expect(detailFromToolInput("Read", {})).toBeUndefined();
    });

    it("returns undefined for non-object input", () => {
      expect(detailFromToolInput("Bash", null)).toBeUndefined();
      expect(detailFromToolInput("Bash", "string")).toBeUndefined();
    });
  });

  describe("pathFromToolInput", () => {
    it("returns path for file tools", () => {
      expect(pathFromToolInput("Read", { file_path: "/tmp/foo" })).toBe("/tmp/foo");
      expect(pathFromToolInput("Edit", { path: "bar.ts" })).toBe("bar.ts");
    });

    it("returns undefined for Bash or non-file tools without path", () => {
      expect(pathFromToolInput("Bash", { command: "ls" })).toBeUndefined();
    });
  });

  describe("classifyClaudeCodeStderrLine", () => {
    it("returns null for empty or whitespace", () => {
      expect(classifyClaudeCodeStderrLine("")).toBeNull();
      expect(classifyClaudeCodeStderrLine("   ")).toBeNull();
    });

    it("strips ANSI escapes and returns message", () => {
      expect(classifyClaudeCodeStderrLine("\x1b[31mError: something\x1b[0m")).toEqual({
        message: "Error: something",
      });
    });

    it("returns null for benign patterns", () => {
      expect(
        classifyClaudeCodeStderrLine(
          "claude code cannot be launched inside another claude code session",
        ),
      ).toBeNull();
      expect(classifyClaudeCodeStderrLine("   at Object.<anonymous>")).toBeNull();
    });

    it("returns message for other lines", () => {
      expect(classifyClaudeCodeStderrLine("Actual error text")).toEqual({
        message: "Actual error text",
      });
    });
  });

  describe("control protocol", () => {
    it("buildControlInitializeMessage produces valid JSON with request_id and sdk_version", () => {
      const msg = buildControlInitializeMessage("req-1");
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("control_request");
      expect(parsed.request_id).toBe("req-1");
      expect(parsed.request.subtype).toBe("initialize");
      expect(parsed.request.sdk_version).toBe(CLAUDE_CODE_SDK_VERSION);
    });

    it("buildControlAllowResponse produces valid JSON", () => {
      const msg = buildControlAllowResponse("req-2");
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("control_response");
      expect(parsed.request_id).toBe("req-2");
      expect(parsed.response.response.behavior).toBe("allow");
    });

    it("buildControlBlockResponse uses default reason when omitted", () => {
      const msg = buildControlBlockResponse("req-3");
      const parsed = JSON.parse(msg);
      expect(parsed.response.response.behavior).toBe("block");
      expect(parsed.response.response.message).toBe("Permission denied.");
    });

    it("buildControlBlockResponse uses custom reason when provided", () => {
      const msg = buildControlBlockResponse("req-4", "Custom reason");
      const parsed = JSON.parse(msg);
      expect(parsed.response.response.message).toBe("Custom reason");
    });
  });

  describe("type guards", () => {
    it("asObject returns object or undefined", () => {
      expect(asObject({ a: 1 })).toEqual({ a: 1 });
      expect(asObject(null)).toBeUndefined();
      expect(asObject(undefined)).toBeUndefined();
      expect(asObject([])).toBeUndefined();
      expect(asObject("str")).toBeUndefined();
    });

    it("asString returns string or undefined", () => {
      expect(asString("hello")).toBe("hello");
      expect(asString(1)).toBeUndefined();
      expect(asString(null)).toBeUndefined();
    });

    it("asArray returns array or undefined", () => {
      expect(asArray([1, 2])).toEqual([1, 2]);
      expect(asArray({})).toBeUndefined();
      expect(asArray("str")).toBeUndefined();
    });
  });

  describe("constants", () => {
    it("exports expected model constants", () => {
      expect(CLAUDE_CODE_DEFAULT_MODEL).toBe("claude-sonnet-4-6");
      expect(CLAUDE_CODE_OPUS_MODEL).toBe("claude-opus-4-6");
    });
  });
});
