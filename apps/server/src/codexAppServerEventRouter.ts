import { randomUUID } from "node:crypto";

import {
  ApprovalRequestId,
  EventId,
  type ProviderEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
} from "@agents/contracts";

import { toCodexUserInputAnswers } from "./codexAppServerHelpers";
import {
  type CodexSessionContext,
  normalizeProviderThreadId,
  type PendingApprovalRequest,
  readBoolean,
  readObject,
  readRouteFields,
  readString,
  requestKindForMethod,
  toTurnId,
} from "./codexAppServerSession";
import type { JsonRpcNotification, JsonRpcResponse } from "./codexAppServerTransport";

export interface JsonRpcRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

interface CodexEventBindings {
  updateSession: (updates: Partial<ProviderSession>) => void;
  emitEvent: (event: ProviderEvent) => void;
  writeMessage: (message: unknown) => void;
}

export function emitLifecycleEvent(
  context: CodexSessionContext,
  method: string,
  message: string,
  emitEvent: (event: ProviderEvent) => void,
): void {
  emitEvent({
    id: EventId.makeUnsafe(randomUUID()),
    kind: "session",
    provider: "codex",
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method,
    message,
  });
}

export function emitErrorEvent(
  context: CodexSessionContext,
  method: string,
  message: string,
  emitEvent: (event: ProviderEvent) => void,
): void {
  emitEvent({
    id: EventId.makeUnsafe(randomUUID()),
    kind: "error",
    provider: "codex",
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method,
    message,
  });
}

export function handleCodexServerNotification(
  context: CodexSessionContext,
  notification: JsonRpcNotification,
  bindings: CodexEventBindings,
): void {
  const route = readRouteFields(notification.params);
  const textDelta =
    notification.method === "item/agentMessage/delta"
      ? readString(notification.params, "delta")
      : undefined;

  bindings.emitEvent({
    id: EventId.makeUnsafe(randomUUID()),
    kind: "notification",
    provider: "codex",
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method: notification.method,
    turnId: route.turnId,
    itemId: route.itemId,
    textDelta,
    payload: notification.params,
  });

  if (notification.method === "thread/started") {
    const providerThreadId = normalizeProviderThreadId(
      readString(readObject(notification.params)?.thread, "id"),
    );
    if (providerThreadId) {
      bindings.updateSession({
        resumeCursor: { threadId: providerThreadId },
      });
    }
    return;
  }

  if (notification.method === "turn/started") {
    const turnId = toTurnId(readString(readObject(notification.params)?.turn, "id"));
    bindings.updateSession({
      status: "running",
      activeTurnId: turnId,
    });
    return;
  }

  if (notification.method === "turn/completed") {
    const turn = readObject(notification.params, "turn");
    const status = readString(turn, "status");
    const errorMessage = readString(readObject(turn, "error"), "message");
    bindings.updateSession({
      status: status === "failed" ? "error" : "ready",
      activeTurnId: undefined,
      lastError: errorMessage ?? context.session.lastError,
    });
    return;
  }

  if (notification.method === "error") {
    const message = readString(readObject(notification.params)?.error, "message");
    const willRetry = readBoolean(notification.params, "willRetry");

    bindings.updateSession({
      status: willRetry ? "running" : "error",
      lastError: message ?? context.session.lastError,
    });
  }
}

export function handleCodexServerRequest(
  context: CodexSessionContext,
  request: JsonRpcRequest,
  bindings: CodexEventBindings,
): void {
  const route = readRouteFields(request.params);
  const requestKind = requestKindForMethod(request.method);
  let requestId: ApprovalRequestId | undefined;

  if (requestKind) {
    requestId = ApprovalRequestId.makeUnsafe(randomUUID());
    const pendingRequest: PendingApprovalRequest = {
      requestId,
      jsonRpcId: request.id,
      method:
        requestKind === "command"
          ? "item/commandExecution/requestApproval"
          : requestKind === "file-read"
            ? "item/fileRead/requestApproval"
            : "item/fileChange/requestApproval",
      requestKind,
      threadId: context.session.threadId,
      ...(route.turnId ? { turnId: route.turnId } : {}),
      ...(route.itemId ? { itemId: route.itemId } : {}),
    };
    context.pendingApprovals.set(requestId, pendingRequest);
  }

  if (request.method === "item/tool/requestUserInput") {
    requestId = ApprovalRequestId.makeUnsafe(randomUUID());
    context.pendingUserInputs.set(requestId, {
      requestId,
      jsonRpcId: request.id,
      threadId: context.session.threadId,
      ...(route.turnId ? { turnId: route.turnId } : {}),
      ...(route.itemId ? { itemId: route.itemId } : {}),
    });
  }

  bindings.emitEvent({
    id: EventId.makeUnsafe(randomUUID()),
    kind: "request",
    provider: "codex",
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method: request.method,
    turnId: route.turnId,
    itemId: route.itemId,
    requestId,
    requestKind,
    payload: request.params,
  });

  if (requestKind || request.method === "item/tool/requestUserInput") {
    return;
  }

  bindings.writeMessage({
    id: request.id,
    error: {
      code: -32601,
      message: `Unsupported server request: ${request.method}`,
    },
  });
}

export function handleCodexResponse(context: CodexSessionContext, response: JsonRpcResponse): void {
  const key = String(response.id);
  const pending = context.pending.get(key);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  context.pending.delete(key);

  if (response.error?.message) {
    pending.reject(new Error(`${pending.method} failed: ${String(response.error.message)}`));
    return;
  }

  pending.resolve(response.result);
}

export function buildUserInputResponseMessage(answers: ProviderUserInputAnswers): {
  result: { answers: ReturnType<typeof toCodexUserInputAnswers> };
} {
  return {
    result: {
      answers: toCodexUserInputAnswers(answers),
    },
  };
}
