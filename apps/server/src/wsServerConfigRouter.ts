import type {
	EditorId,
	ServerProviderStatus,
	WebSocketRequest,
} from "@agentz/contracts";
import { WS_METHODS } from "@agentz/contracts";
import { Effect } from "effect";

import type { KeybindingsShape } from "./keybindings";
import {
	stripRequestTag,
	toRouteRequestError,
	WS_ROUTE_UNHANDLED,
	type WsRouteHandler,
} from "./wsRouteSupport";

export interface ServerConfigRouterContext {
	cwd: string;
	keybindingsConfigPath: string;
	availableEditors: ReadonlyArray<EditorId>;
	providerStatuses: ReadonlyArray<ServerProviderStatus>;
	keybindingsManager: KeybindingsShape;
}

export function createServerConfigRouter(
	context: ServerConfigRouterContext,
): WsRouteHandler {
	return (request: WebSocketRequest) => {
		switch (request.body._tag) {
			case WS_METHODS.serverGetConfig:
				return Effect.gen(function* () {
					const keybindingsConfig =
						yield* context.keybindingsManager.loadConfigState;
					return {
						cwd: context.cwd,
						keybindingsConfigPath: context.keybindingsConfigPath,
						keybindings: keybindingsConfig.keybindings,
						issues: keybindingsConfig.issues,
						providers: context.providerStatuses,
						availableEditors: context.availableEditors,
					};
				}).pipe(Effect.mapError(toRouteRequestError));

			case WS_METHODS.serverUpsertKeybinding:
				return Effect.gen(function* () {
					const body = stripRequestTag(
						request.body as Extract<
							WebSocketRequest["body"],
							{ _tag: typeof WS_METHODS.serverUpsertKeybinding }
						>,
					);
					const keybindingsConfig =
						yield* context.keybindingsManager.upsertKeybindingRule(body);
					return { keybindings: keybindingsConfig, issues: [] };
				}).pipe(Effect.mapError(toRouteRequestError));

			default:
				return Effect.succeed(WS_ROUTE_UNHANDLED);
		}
	};
}
