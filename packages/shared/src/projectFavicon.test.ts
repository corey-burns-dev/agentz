import { describe, expect, it } from "vitest";

import {
  compareProjectFaviconPaths,
  getProjectFaviconPathScore,
  isLikelyProjectFaviconPath,
  isProjectImageFilePath,
  normalizeProjectRelativePath,
} from "./projectFavicon";

describe("projectFavicon helpers", () => {
  it("normalizes slash variants into clean relative paths", () => {
    expect(normalizeProjectRelativePath("./public\\favicon.svg")).toBe("public/favicon.svg");
  });

  it("recognizes supported image extensions", () => {
    expect(isProjectImageFilePath("public/favicon.svg")).toBe(true);
    expect(isProjectImageFilePath("public/favicon.webp")).toBe(true);
    expect(isProjectImageFilePath("README.md")).toBe(false);
  });

  it("flags common favicon-style basenames as likely candidates", () => {
    expect(isLikelyProjectFaviconPath("public/favicon.svg")).toBe(true);
    expect(isLikelyProjectFaviconPath("src/app/apple-touch-icon.png")).toBe(true);
    expect(isLikelyProjectFaviconPath("assets/brandmark.png")).toBe(false);
  });

  it("prefers canonical favicon locations over generic image files", () => {
    expect(getProjectFaviconPathScore("public/favicon.svg")).toBeLessThan(
      getProjectFaviconPathScore("assets/logo.png"),
    );
  });

  it("sorts favicon-like paths ahead of generic logos", () => {
    expect(["assets/logo.png", "public/favicon.svg"].toSorted(compareProjectFaviconPaths)).toEqual([
      "public/favicon.svg",
      "assets/logo.png",
    ]);
  });
});
