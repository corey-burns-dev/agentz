import { describe, expect, it } from "vitest";
import {
  parseSettingsTab,
  SETTINGS_TABS,
  stripSettingsTabSearchParams,
} from "./-settingsNavigation";

describe("parseSettingsTab", () => {
  it("keeps known tabs", () => {
    for (const tab of SETTINGS_TABS) {
      expect(parseSettingsTab(tab.id)).toBe(tab.id);
    }
  });

  it("falls back to appearance for invalid values", () => {
    expect(parseSettingsTab("unknown")).toBe("appearance");
    expect(parseSettingsTab(null)).toBe("appearance");
    expect(parseSettingsTab(42)).toBe("appearance");
  });

  it("removes the settings tab key from shared search state", () => {
    expect(
      stripSettingsTabSearchParams({
        tab: "appearance",
        diff: "1",
        projectDock: "1",
      }),
    ).toEqual({
      diff: "1",
      projectDock: "1",
    });
  });
});
