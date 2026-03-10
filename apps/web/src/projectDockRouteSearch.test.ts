import { describe, expect, it } from "vitest";
import {
  parseProjectDockRouteSearch,
  stripProjectDockSearchParams,
} from "./projectDockRouteSearch";

describe("parseProjectDockRouteSearch", () => {
  it("returns a closed dock when the flag is absent", () => {
    expect(parseProjectDockRouteSearch({})).toEqual({});
  });

  it("defaults the tab to git when the dock is open", () => {
    expect(
      parseProjectDockRouteSearch({
        projectDock: "1",
      }),
    ).toEqual({
      projectDock: "1",
      projectDockTab: "git",
    });
  });

  it("keeps a valid tab when present", () => {
    expect(
      parseProjectDockRouteSearch({
        projectDock: true,
        projectDockTab: "files",
      }),
    ).toEqual({
      projectDock: "1",
      projectDockTab: "files",
    });
  });
});

describe("stripProjectDockSearchParams", () => {
  it("removes project dock params while preserving other search state", () => {
    expect(
      stripProjectDockSearchParams({
        projectDock: "1",
        projectDockTab: "files",
        diff: "1",
      }),
    ).toEqual({
      diff: "1",
    });
  });
});
