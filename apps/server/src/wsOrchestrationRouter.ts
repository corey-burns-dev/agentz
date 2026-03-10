import type {
  ClientOrchestrationCommand,
  OrchestrationCommand,
  WebSocketRequest,
} from "@agents/contracts";
import { ORCHESTRATION_WS_METHODS } from "@agents/contracts";
import { Effect, Stream } from "effect";
import { clamp } from "effect/Number";

import type { CheckpointDiffQueryShape } from "./checkpointing/Services/CheckpointDiffQuery";
import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  type RouteRequestError,
  stripRequestTag,
  toRouteRequestError,
  WS_ROUTE_UNHANDLED,
  type WsRouteHandler,
} from "./wsRouteSupport";

export interface OrchestrationRouterContext {
  orchestrationEngine: OrchestrationEngineShape;
  projectionReadModelQuery: ProjectionSnapshotQueryShape;
  checkpointDiffQuery: CheckpointDiffQueryShape;
  normalizeDispatchCommand: (input: {
    readonly command: ClientOrchestrationCommand;
  }) => Effect.Effect<OrchestrationCommand, RouteRequestError, never>;
}

export function createOrchestrationRouter(context: OrchestrationRouterContext): WsRouteHandler {
  return (request: WebSocketRequest) => {
    switch (request.body._tag) {
      case ORCHESTRATION_WS_METHODS.getSnapshot:
        return context.projectionReadModelQuery
          .getSnapshot()
          .pipe(Effect.mapError(toRouteRequestError));

      case ORCHESTRATION_WS_METHODS.dispatchCommand:
        return Effect.gen(function* () {
          const { command } = request.body as Extract<
            WebSocketRequest["body"],
            { _tag: typeof ORCHESTRATION_WS_METHODS.dispatchCommand }
          >;
          const normalizedCommand = yield* context.normalizeDispatchCommand({
            command,
          });
          return yield* context.orchestrationEngine.dispatch(normalizedCommand);
        }).pipe(Effect.mapError(toRouteRequestError));

      case ORCHESTRATION_WS_METHODS.getTurnDiff:
        return context.checkpointDiffQuery
          .getTurnDiff(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof ORCHESTRATION_WS_METHODS.getTurnDiff }
              >,
            ),
          )
          .pipe(Effect.mapError(toRouteRequestError));

      case ORCHESTRATION_WS_METHODS.getFullThreadDiff:
        return context.checkpointDiffQuery
          .getFullThreadDiff(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff }
              >,
            ),
          )
          .pipe(Effect.mapError(toRouteRequestError));

      case ORCHESTRATION_WS_METHODS.replayEvents: {
        const { fromSequenceExclusive } = request.body as Extract<
          WebSocketRequest["body"],
          { _tag: typeof ORCHESTRATION_WS_METHODS.replayEvents }
        >;
        return Stream.runCollect(
          context.orchestrationEngine.readEvents(
            clamp(fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(
          Effect.map((events) => Array.from(events)),
          Effect.mapError(toRouteRequestError),
        );
      }

      default:
        return Effect.succeed(WS_ROUTE_UNHANDLED);
    }
  };
}
