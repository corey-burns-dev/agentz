import type { ServerProviderStatus } from "@agents/contracts";
import { describe, expect, it } from "vitest";
import type { AppSettings } from "./appSettings";
import { resolveSelectedProvider, resolveVisibleProviderOptions } from "./providerSelection";

const BASE_SETTINGS: Pick<
  AppSettings,
  | "codexBinaryPath"
  | "codexHomePath"
  | "geminiBinaryPath"
  | "geminiHomePath"
  | "claudeCodeBinaryPath"
  | "claudeCodeHomePath"
> = {
  codexBinaryPath: "",
  codexHomePath: "",
  geminiBinaryPath: "",
  geminiHomePath: "",
  claudeCodeBinaryPath: "",
  claudeCodeHomePath: "",
};

function makeStatus(
  provider: ServerProviderStatus["provider"],
  available: boolean,
): ServerProviderStatus {
  return {
    provider,
    status: available ? "ready" : "error",
    available,
    authStatus: available ? "authenticated" : "unknown",
    checkedAt: "2026-03-09T00:00:00.000Z",
  };
}

describe("resolveSelectedProvider", () => {
  it("prefers a draft override", () => {
    expect(
      resolveSelectedProvider({
        draftProvider: "claude-code",
        sessionProvider: "gemini",
        threadModel: "gpt-5.4",
      }),
    ).toBe("claude-code");
  });

  it("falls back to the active session provider", () => {
    expect(
      resolveSelectedProvider({
        sessionProvider: "gemini",
        threadModel: "gpt-5.4",
      }),
    ).toBe("gemini");
  });

  it("infers the provider from the thread or project model", () => {
    expect(
      resolveSelectedProvider({
        threadModel: "claude-opus-4-6",
      }),
    ).toBe("claude-code");
    expect(
      resolveSelectedProvider({
        projectModel: "gemini-2.5-pro",
      }),
    ).toBe("gemini");
  });
});

describe("resolveVisibleProviderOptions", () => {
  it("shows all supported providers before health data loads", () => {
    expect(
      resolveVisibleProviderOptions({
        providerStatuses: [],
        settings: BASE_SETTINGS,
      }).map((option) => option.value),
    ).toEqual(["codex", "gemini", "claude-code"]);
  });

  it("keeps a provider visible when a binary override is configured", () => {
    expect(
      resolveVisibleProviderOptions({
        providerStatuses: [
          makeStatus("codex", true),
          makeStatus("gemini", false),
          makeStatus("claude-code", true),
        ],
        settings: {
          ...BASE_SETTINGS,
          geminiBinaryPath: "/opt/bin/gemini",
        },
      }).map((option) => option.value),
    ).toEqual(["codex", "gemini", "claude-code"]);
  });

  it("falls back to all providers when health reports none as available", () => {
    expect(
      resolveVisibleProviderOptions({
        providerStatuses: [
          makeStatus("codex", false),
          makeStatus("gemini", false),
          makeStatus("claude-code", false),
        ],
        settings: BASE_SETTINGS,
      }).map((option) => option.value),
    ).toEqual(["codex", "gemini", "claude-code"]);
  });
});
