import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubBrowserEnvironment(rawState: string | null = null) {
  const storage = new Map<string, string>();
  if (rawState !== null) {
    storage.set("agents:project-favicons:v1", rawState);
  }

  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  return { storage };
}

describe("projectFaviconSettings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes persisted paths before exposing them", async () => {
    stubBrowserEnvironment(
      JSON.stringify({
        byProjectKey: {
          "/repo": "./public\\favicon.svg",
        },
      }),
    );
    const { getProjectFaviconOverrideForKey } = await import("./projectFaviconSettings");

    expect(getProjectFaviconOverrideForKey("/repo")).toBe("public/favicon.svg");
  });

  it("stores and clears overrides by project key", async () => {
    const { storage } = stubBrowserEnvironment();
    const {
      clearProjectFaviconOverrideForKey,
      getProjectFaviconOverrideForKey,
      getProjectFaviconSetAtForKey,
      setProjectFaviconOverrideForKey,
    } = await import("./projectFaviconSettings");

    setProjectFaviconOverrideForKey("/repo", "assets/icon.svg");
    expect(getProjectFaviconOverrideForKey("/repo")).toBe("assets/icon.svg");
    expect(getProjectFaviconSetAtForKey("/repo")).toBeGreaterThan(0);
    expect(storage.get("agents:project-favicons:v1")).toContain("assets/icon.svg");

    clearProjectFaviconOverrideForKey("/repo");
    expect(getProjectFaviconOverrideForKey("/repo")).toBeNull();
    expect(getProjectFaviconSetAtForKey("/repo")).toBe(0);
    const stored = JSON.parse(storage.get("agents:project-favicons:v1") ?? "{}");
    expect(stored).toMatchObject({ byProjectKey: {} });
  });
});
