import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexCssPath = resolve(import.meta.dirname, "index.css");

describe("index.css theme preset selectors", () => {
  it("scopes dark preset overrides to html.dark so they win over base dark tokens", () => {
    const css = readFileSync(indexCssPath, "utf8");

    expect(css).toContain('html.dark[data-theme="midnight"]');
    expect(css).toContain('html.dark[data-theme="nord"]');
    expect(css).toContain('html.dark[data-theme="catppuccin-mocha"]');
  });
});
