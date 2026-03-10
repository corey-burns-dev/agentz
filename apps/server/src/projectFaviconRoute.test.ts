import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { tryHandleProjectFaviconRequest } from "./projectFaviconRoute";

interface HttpResponse {
  statusCode: number;
  contentType: string | null;
  body: string;
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function withRouteServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (tryHandleProjectFaviconRequest(url, res)) {
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected server address to be an object");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function request(baseUrl: string, pathname: string): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

describe("tryHandleProjectFaviconRequest", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 400 when cwd is missing", async () => {
    await withRouteServer(async (baseUrl) => {
      const response = await request(baseUrl, "/api/project-favicon");
      expect(response.statusCode).toBe(400);
      expect(response.body).toBe("Missing cwd parameter");
    });
  });

  it("serves a well-known favicon file from the project root", async () => {
    const projectDir = makeTempDir("agents-favicon-route-root-");
    fs.writeFileSync(path.join(projectDir, "favicon.svg"), "<svg>favicon</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>favicon</svg>");
    });
  });

  it("serves a well-known favicon file from a nested frontend app root", async () => {
    const projectDir = makeTempDir("agents-favicon-route-frontend-root-");
    const iconPath = path.join(projectDir, "frontend", "public", "favicon.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>frontend-favicon</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>frontend-favicon</svg>");
    });
  });

  it("resolves icon href from source files when no well-known favicon exists", async () => {
    const projectDir = makeTempDir("agents-favicon-route-source-");
    const iconPath = path.join(projectDir, "public", "brand", "logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      '<link rel="icon" href="/brand/logo.svg">',
    );
    fs.writeFileSync(iconPath, "<svg>brand</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>brand</svg>");
    });
  });

  it("resolves icon href from a nested frontend source file", async () => {
    const projectDir = makeTempDir("agents-favicon-route-frontend-source-");
    const iconPath = path.join(projectDir, "frontend", "public", "brand", "logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "frontend", "index.html"),
      '<link rel="icon" href="/brand/logo.svg">',
    );
    fs.writeFileSync(iconPath, "<svg>frontend-brand</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>frontend-brand</svg>");
    });
  });

  it("resolves icon link when href appears before rel in HTML", async () => {
    const projectDir = makeTempDir("agents-favicon-route-html-order-");
    const iconPath = path.join(projectDir, "public", "brand", "logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      '<link href="/brand/logo.svg" rel="icon">',
    );
    fs.writeFileSync(iconPath, "<svg>brand-html-order</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>brand-html-order</svg>");
    });
  });

  it("resolves object-style icon metadata when href appears before rel", async () => {
    const projectDir = makeTempDir("agents-favicon-route-obj-order-");
    const iconPath = path.join(projectDir, "public", "brand", "obj.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "src", "root.tsx"),
      'const links = [{ href: "/brand/obj.svg", rel: "icon" }];',
      "utf8",
    );
    fs.writeFileSync(iconPath, "<svg>brand-obj-order</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>brand-obj-order</svg>");
    });
  });

  it("serves an explicit relativePath override when requested", async () => {
    const projectDir = makeTempDir("agents-favicon-route-override-");
    const iconPath = path.join(projectDir, "assets", "brand", "icon.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>override</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}&relativePath=${encodeURIComponent("assets/brand/icon.svg")}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>override</svg>");
    });
  });

  it("serves a well-known favicon from apps/web (monorepo) when no root-level favicon exists", async () => {
    const projectDir = makeTempDir("agents-favicon-route-apps-web-");
    const iconPath = path.join(projectDir, "apps", "web", "public", "favicon.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>apps-web-favicon</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>apps-web-favicon</svg>");
    });
  });

  it("serves a well-known favicon from packages/site (monorepo) when no root-level favicon exists", async () => {
    const projectDir = makeTempDir("agents-favicon-route-packages-site-");
    const iconPath = path.join(projectDir, "packages", "site", "public", "favicon.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>packages-site-favicon</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>packages-site-favicon</svg>");
    });
  });

  it("recursively scans the workspace for favicon-like files when well-known locations miss", async () => {
    const projectDir = makeTempDir("agents-favicon-route-recursive-");
    const iconPath = path.join(projectDir, "packages", "site", "assets", "favicon-logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>recursive</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>recursive</svg>");
    });
  });

  it("serves a well-known favicon from backend/priv/static (Phoenix/Elixir)", async () => {
    const projectDir = makeTempDir("agents-favicon-route-backend-priv-");
    const iconPath = path.join(projectDir, "backend", "priv", "static", "favicon.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>phoenix-favicon</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>phoenix-favicon</svg>");
    });
  });

  it("serves public/logo.svg when no favicon exists (e.g. agents monorepo)", async () => {
    const projectDir = makeTempDir("agents-favicon-route-public-logo-");
    const iconPath = path.join(projectDir, "apps", "web", "public", "logo.svg");
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "<svg>logo</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>logo</svg>");
    });
  });

  it("resolves cwd when given as file:// URL", async () => {
    const projectDir = makeTempDir("agents-favicon-route-file-url-");
    fs.writeFileSync(path.join(projectDir, "favicon.svg"), "<svg>file-url</svg>", "utf8");

    await withRouteServer(async (baseUrl) => {
      const fileUrl =
        path.sep === "\\" ? `file:///${projectDir.replace(/\\/g, "/")}` : `file://${projectDir}`;
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(fileUrl)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toBe("<svg>file-url</svg>");
    });
  });

  it("serves a fallback favicon when no icon exists", async () => {
    const projectDir = makeTempDir("agents-favicon-route-fallback-");

    await withRouteServer(async (baseUrl) => {
      const pathname = `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`;
      const response = await request(baseUrl, pathname);
      expect(response.statusCode).toBe(200);
      expect(response.contentType).toContain("image/svg+xml");
      expect(response.body).toContain('data-fallback="project-favicon"');
    });
  });
});
