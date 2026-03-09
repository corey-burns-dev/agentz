import { type WebSocketRequest, WS_METHODS } from "@agents/contracts";
import { Effect } from "effect";

import type { GitCoreShape } from "./git/Services/GitCore.ts";
import type { GitManagerShape } from "./git/Services/GitManager.ts";
import {
	stripRequestTag,
	toRouteRequestError,
	WS_ROUTE_UNHANDLED,
	type WsRouteHandler,
} from "./wsRouteSupport";

export interface GitRouterContext {
	gitManager: GitManagerShape;
	git: GitCoreShape;
}

export function createGitRouter(context: GitRouterContext): WsRouteHandler {
	return (request: WebSocketRequest) => {
		switch (request.body._tag) {
			case WS_METHODS.gitStatus:
				return context.gitManager
					.status(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitPull:
				return context.git
					.pullCurrentBranch(stripRequestTag(request.body).cwd)
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitListIssues:
				return context.gitManager
					.listIssues(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitRunStackedAction:
				return context.gitManager
					.runStackedAction(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitListBranches:
				return context.git
					.listBranches(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitCreateWorktree:
				return context.git
					.createWorktree(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitRemoveWorktree:
				return context.git
					.removeWorktree(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitCreateBranch:
				return context.git
					.createBranch(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitCheckout:
				return Effect.scoped(
					context.git.checkoutBranch(stripRequestTag(request.body)),
				).pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.gitInit:
				return context.git
					.initRepo(stripRequestTag(request.body))
					.pipe(Effect.mapError(toRouteRequestError));

			default:
				return Effect.succeed(WS_ROUTE_UNHANDLED);
		}
	};
}
