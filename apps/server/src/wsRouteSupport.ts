import type { WebSocketRequest } from "@agentz/contracts";
import {
	Effect,
	type Effect as EffectType,
	type FileSystem,
	type Path,
	Schema,
	Struct,
} from "effect";

export const WS_ROUTE_UNHANDLED = Symbol("WS_ROUTE_UNHANDLED");

export type WsRouteResult = unknown | typeof WS_ROUTE_UNHANDLED;

export class RouteRequestError extends Schema.TaggedErrorClass<RouteRequestError>()(
	"RouteRequestError",
	{
		message: Schema.String,
	},
) {}

export function toRouteRequestError(error: unknown): RouteRequestError {
	if (
		error &&
		typeof error === "object" &&
		"_tag" in error &&
		error._tag === "RouteRequestError"
	) {
		return error as RouteRequestError;
	}
	const message =
		error instanceof Error ? error.message : String(error ?? "Unknown error");
	return new RouteRequestError({ message });
}

export function stripRequestTag<T extends { _tag: string }>(body: T) {
	return Struct.omit(body, ["_tag"]);
}

function toPosixRelativePath(input: string): string {
	return input.replaceAll("\\", "/");
}

export function resolveWorkspaceWritePath(params: {
	workspaceRoot: string;
	relativePath: string;
	path: Path.Path;
}): Effect.Effect<
	{ absolutePath: string; relativePath: string },
	RouteRequestError
> {
	const normalizedInputPath = params.relativePath.trim();
	if (params.path.isAbsolute(normalizedInputPath)) {
		return Effect.fail(
			new RouteRequestError({
				message: "Workspace file path must be relative to the project root.",
			}),
		);
	}

	const absolutePath = params.path.resolve(
		params.workspaceRoot,
		normalizedInputPath,
	);
	const relativeToRoot = toPosixRelativePath(
		params.path.relative(params.workspaceRoot, absolutePath),
	);
	if (
		relativeToRoot.length === 0 ||
		relativeToRoot === "." ||
		relativeToRoot.startsWith("../") ||
		relativeToRoot === ".." ||
		params.path.isAbsolute(relativeToRoot)
	) {
		return Effect.fail(
			new RouteRequestError({
				message: "Workspace file path must stay within the project root.",
			}),
		);
	}

	return Effect.succeed({
		absolutePath,
		relativePath: relativeToRoot,
	});
}

export interface WorkspaceRouteContext {
	fileSystem: FileSystem.FileSystem;
	path: Path.Path;
}

export type WsRouteHandler = (
	request: WebSocketRequest,
) => EffectType.Effect<WsRouteResult, RouteRequestError, never>;
