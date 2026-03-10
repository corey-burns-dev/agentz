import { type OpenInEditorInput, type WebSocketRequest, WS_METHODS } from "@agents/contracts";
import { Effect } from "effect";

import type { OpenShape } from "./open";
import { searchWorkspaceEntries } from "./workspaceEntries";
import {
  RouteRequestError,
  resolveWorkspaceFilePath,
  stripRequestTag,
  toRouteRequestError,
  type WorkspaceRouteContext,
  WS_ROUTE_UNHANDLED,
  type WsRouteHandler,
} from "./wsRouteSupport";

export interface WorkspaceRouterContext extends WorkspaceRouteContext {
  openInEditor: OpenShape["openInEditor"];
}

export function createWorkspaceRouter(context: WorkspaceRouterContext): WsRouteHandler {
  return (request: WebSocketRequest) => {
    switch (request.body._tag) {
      case WS_METHODS.projectsSearchEntries: {
        const body = stripRequestTag(
          request.body as Extract<
            WebSocketRequest["body"],
            { _tag: typeof WS_METHODS.projectsSearchEntries }
          >,
        );
        return Effect.tryPromise({
          try: () => searchWorkspaceEntries(body),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace entries: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsReadFile:
        return Effect.gen(function* () {
          const body = stripRequestTag(
            request.body as Extract<
              WebSocketRequest["body"],
              { _tag: typeof WS_METHODS.projectsReadFile }
            >,
          );
          const target = yield* resolveWorkspaceFilePath({
            workspaceRoot: body.cwd,
            relativePath: body.relativePath,
            path: context.path,
          });
          const exists = yield* context.fileSystem.exists(target.absolutePath).pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to check workspace file: ${String(cause)}`,
                }),
            ),
          );
          if (!exists) {
            return {
              relativePath: target.relativePath,
              exists: false,
              contents: null,
            };
          }
          const contents = yield* context.fileSystem.readFileString(target.absolutePath).pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to read workspace file: ${String(cause)}`,
                }),
            ),
          );
          return {
            relativePath: target.relativePath,
            exists: true,
            contents,
          };
        });

      case WS_METHODS.projectsWriteFile:
        return Effect.gen(function* () {
          const body = stripRequestTag(
            request.body as Extract<
              WebSocketRequest["body"],
              { _tag: typeof WS_METHODS.projectsWriteFile }
            >,
          );
          const target = yield* resolveWorkspaceFilePath({
            workspaceRoot: body.cwd,
            relativePath: body.relativePath,
            path: context.path,
          });
          yield* context.fileSystem
            .makeDirectory(context.path.dirname(target.absolutePath), {
              recursive: true,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new RouteRequestError({
                    message: `Failed to prepare workspace path: ${String(cause)}`,
                  }),
              ),
            );
          yield* context.fileSystem.writeFileString(target.absolutePath, body.contents).pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to write workspace file: ${String(cause)}`,
                }),
            ),
          );
          return { relativePath: target.relativePath };
        });

      case WS_METHODS.shellOpenInEditor:
        return context
          .openInEditor(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.shellOpenInEditor }
              >,
            ) as OpenInEditorInput,
          )
          .pipe(Effect.mapError(toRouteRequestError));

      default:
        return Effect.succeed(WS_ROUTE_UNHANDLED);
    }
  };
}
