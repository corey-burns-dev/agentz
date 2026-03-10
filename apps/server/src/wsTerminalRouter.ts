import { type WebSocketRequest, WS_METHODS } from "@agents/contracts";
import { Effect } from "effect";

import type { TerminalManagerShape } from "./terminal/Services/Manager.ts";
import {
  stripRequestTag,
  toRouteRequestError,
  WS_ROUTE_UNHANDLED,
  type WsRouteHandler,
} from "./wsRouteSupport";

export interface TerminalRouterContext {
  terminalManager: TerminalManagerShape;
}

export function createTerminalRouter(context: TerminalRouterContext): WsRouteHandler {
  return (request: WebSocketRequest) => {
    switch (request.body._tag) {
      case WS_METHODS.terminalOpen:
        return context.terminalManager
          .open(stripRequestTag(request.body))
          .pipe(Effect.mapError(toRouteRequestError));

      case WS_METHODS.terminalWrite:
        return context.terminalManager
          .write(stripRequestTag(request.body))
          .pipe(Effect.mapError(toRouteRequestError));

      case WS_METHODS.terminalResize:
        return context.terminalManager
          .resize(stripRequestTag(request.body))
          .pipe(Effect.mapError(toRouteRequestError));

      case WS_METHODS.terminalClear:
        return context.terminalManager
          .clear(stripRequestTag(request.body))
          .pipe(Effect.mapError(toRouteRequestError));

      case WS_METHODS.terminalRestart:
        return context.terminalManager
          .restart(stripRequestTag(request.body))
          .pipe(Effect.mapError(toRouteRequestError));

      case WS_METHODS.terminalClose:
        return context.terminalManager
          .close(stripRequestTag(request.body))
          .pipe(Effect.mapError(toRouteRequestError));

      default:
        return Effect.succeed(WS_ROUTE_UNHANDLED);
    }
  };
}
