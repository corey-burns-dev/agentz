import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type WebSocketRequest, WS_METHODS } from "@agents/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceRouter } from "./wsWorkspaceRouter";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function makeRequest(body: WebSocketRequest["body"]): WebSocketRequest {
	return {
		id: "req-1",
		body,
	};
}

async function runWorkspaceRoute(request: WebSocketRequest): Promise<unknown> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const pathService = yield* Path.Path;
		const route = createWorkspaceRouter({
			fileSystem,
			path: pathService,
			openInEditor: () => Effect.void,
		});
		return yield* route(request);
	}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
}

describe("createWorkspaceRouter", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0, tempDirs.length)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads an existing workspace file", async () => {
		const workspace = makeTempDir("agents-workspace-router-read-");
		fs.writeFileSync(
			path.join(workspace, "TODO.md"),
			"# TODO\n\n- [ ] Ship it\n",
			"utf8",
		);

		const result = await runWorkspaceRoute(
			makeRequest({
				_tag: WS_METHODS.projectsReadFile,
				cwd: workspace,
				relativePath: "TODO.md",
			}),
		);

		expect(result).toEqual({
			relativePath: "TODO.md",
			exists: true,
			contents: "# TODO\n\n- [ ] Ship it\n",
		});
	});

	it("returns exists false when the workspace file is missing", async () => {
		const workspace = makeTempDir("agents-workspace-router-missing-");

		const result = await runWorkspaceRoute(
			makeRequest({
				_tag: WS_METHODS.projectsReadFile,
				cwd: workspace,
				relativePath: "TODO.md",
			}),
		);

		expect(result).toEqual({
			relativePath: "TODO.md",
			exists: false,
			contents: null,
		});
	});

	it("rejects workspace file reads outside the project root", async () => {
		const workspace = makeTempDir("agents-workspace-router-reject-");

		await expect(
			runWorkspaceRoute(
				makeRequest({
					_tag: WS_METHODS.projectsReadFile,
					cwd: workspace,
					relativePath: "../escape.md",
				}),
			),
		).rejects.toMatchObject({
			message: expect.stringContaining(
				"Workspace file path must stay within the project root.",
			),
		});
	});
});
