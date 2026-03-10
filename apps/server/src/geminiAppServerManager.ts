import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { resolve as resolvePath } from "node:path";
import readline from "node:readline";

import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  ProviderItemId,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type ThreadId,
  TurnId,
} from "@agents/contracts";
import { Effect, type ServiceMap } from "effect";
import {
  buildGeminiInitializeParams,
  killChildTree,
  normalizeGeminiModelSlug,
  toGeminiUserInputAnswers,
} from "./geminiAppServerHelpers";
import {
  assertSupportedGeminiCliVersion,
  type GeminiAccountSnapshot,
  type GeminiActiveTurnContext,
  type GeminiAppServerSendTurnInput,
  type GeminiAppServerStartSessionInput,
  type GeminiSessionContext,
  type GeminiThreadSnapshot,
  type GeminiTurnItemSnapshot,
  type PendingApprovalRequest,
  readGeminiProviderOptions,
  readResumeThreadId,
  readString,
  updateSession,
} from "./geminiAppServerSession";
import {
  attachGeminiTransportListeners,
  type JsonRpcNotification,
  type JsonRpcResponse,
  routeGeminiProtocolLine,
  sendJsonRpcRequest,
  writeJsonRpcMessage,
} from "./geminiAppServerTransport";
import { ProviderBusyError } from "./provider/providerBusyError";

export type {
  GeminiAppServerSendTurnInput,
  GeminiAppServerStartSessionInput,
} from "./geminiAppServerSession";

type GeminiPromptPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      mimeType: string;
      data: string;
    };

type GeminiAcpToolContent =
  | {
      type: "content";
      content?: {
        type?: string;
        text?: string;
      };
    }
  | {
      type: "diff";
      path?: string;
      oldText?: string;
      newText?: string;
    }
  | {
      type: "terminal";
      terminalId?: string;
    };

type GeminiAcpToolCall = {
  toolCallId?: string;
  title?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
  kind?: string;
  content?: GeminiAcpToolContent[];
};

const PROMPT_TIMEOUT_MS = 15 * 60_000;
const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/;

export interface GeminiAppServerManagerEvents {
  event: [event: ProviderEvent];
}

function emitProviderEvent(event: ProviderEvent): ProviderEvent {
  return event;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function parseDataUrl(value: string): { mimeType: string; data: string } {
  const match = DATA_URL_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) {
    throw new Error("Gemini image attachments must be base64 data URLs.");
  }
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function runtimeModeToSessionMode(runtimeMode: ProviderSession["runtimeMode"]): "default" | "yolo" {
  return runtimeMode === "approval-required" ? "default" : "yolo";
}

function requestBindingFromToolKind(kind: string | undefined): {
  method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/fileRead/requestApproval";
  requestKind: PendingApprovalRequest["requestKind"];
} {
  switch (kind) {
    case "edit":
    case "delete":
    case "move":
      return {
        method: "item/fileChange/requestApproval",
        requestKind: "file-change",
      };
    case "read":
    case "search":
      return {
        method: "item/fileRead/requestApproval",
        requestKind: "file-read",
      };
    default:
      return {
        method: "item/commandExecution/requestApproval",
        requestKind: "command",
      };
  }
}

function providerItemTypeFromToolCall(toolCall: GeminiAcpToolCall): string {
  switch (toolCall.kind) {
    case "edit":
    case "delete":
    case "move":
      return "fileChange";
    case "execute":
      return "commandExecution";
    case "read":
    case "search":
      return "dynamicToolCall";
    default:
      return "dynamicToolCall";
  }
}

function outputDeltaMethodFromItemType(itemType: string): string | undefined {
  switch (itemType) {
    case "fileChange":
      return "item/fileChange/outputDelta";
    case "commandExecution":
      return "item/commandExecution/outputDelta";
    default:
      return undefined;
  }
}

function textFromToolContent(
  content: ReadonlyArray<GeminiAcpToolContent> | undefined,
): string | undefined {
  if (!content) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const entry of content) {
    if (entry.type === "content") {
      const text = entry.content?.text?.trim();
      if (text) {
        chunks.push(text);
      }
      continue;
    }

    if (entry.type === "diff" && entry.path) {
      chunks.push(`Updated ${entry.path}`);
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return chunks.join("\n");
}

function pathFromToolContent(
  content: ReadonlyArray<GeminiAcpToolContent> | undefined,
): string | undefined {
  if (!content) {
    return undefined;
  }
  for (const entry of content) {
    if (entry.type === "diff" && entry.path) {
      return entry.path;
    }
  }
  return undefined;
}

function cloneTurnItem(item: GeminiTurnItemSnapshot): GeminiTurnItemSnapshot {
  return {
    ...item,
    ...(item.content ? { content: [...item.content] } : {}),
  };
}

export class GeminiAppServerManager extends EventEmitter<GeminiAppServerManagerEvents> {
  private readonly sessions = new Map<ThreadId, GeminiSessionContext>();

  private readonly runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>;

  constructor(services?: ServiceMap.ServiceMap<never>) {
    super();
    this.runPromise = services ? Effect.runPromiseWith(services) : Effect.runPromise;
  }

  async startSession(input: GeminiAppServerStartSessionInput): Promise<ProviderSession> {
    const threadId = input.threadId;
    const now = new Date().toISOString();
    let context: GeminiSessionContext | undefined;

    try {
      const resolvedCwd = resolvePath(input.cwd ?? process.cwd());
      const model = normalizeGeminiModelSlug(input.model);
      const geminiOptions = readGeminiProviderOptions(input);
      const geminiBinaryPath = geminiOptions.binaryPath ?? "gemini";
      const geminiHomePath = geminiOptions.homePath;

      this.assertSupportedGeminiCliVersion({
        binaryPath: geminiBinaryPath,
        cwd: resolvedCwd,
        ...(geminiHomePath ? { homePath: geminiHomePath } : {}),
      });

      const child = spawn(
        geminiBinaryPath,
        this.buildSpawnArgs({
          runtimeMode: input.runtimeMode,
          ...(model ? { model } : {}),
        }),
        {
          cwd: resolvedCwd,
          env: {
            ...process.env,
            ...(geminiHomePath ? { GEMINI_HOME: geminiHomePath } : {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        },
      );
      const output = readline.createInterface({ input: child.stdout });

      context = {
        session: {
          provider: "gemini",
          status: "connecting",
          runtimeMode: input.runtimeMode,
          ...(model ? { model } : {}),
          cwd: resolvedCwd,
          threadId,
          createdAt: now,
          updatedAt: now,
        },
        account: {
          type: "unknown",
          planType: null,
          sparkEnabled: true,
        } satisfies GeminiAccountSnapshot,
        child: child as ChildProcessWithoutNullStreams,
        output,
        pending: new Map(),
        pendingApprovals: new Map(),
        pendingUserInputs: new Map(),
        nextRequestId: 1,
        stopping: false,
        turns: [],
        suppressUpdatesUntilTurn: false,
      };

      this.sessions.set(threadId, context);
      this.attachProcessListeners(context);

      this.emitLifecycleEvent(context, "session/connecting", "Starting Gemini ACP session");

      await this.sendRequest(context, "initialize", buildGeminiInitializeParams());

      const resumeSessionId = readResumeThreadId(input);
      if (resumeSessionId) {
        context.suppressUpdatesUntilTurn = true;
        await this.sendRequest(context, "session/load", {
          sessionId: resumeSessionId,
          cwd: resolvedCwd,
          mcpServers: [],
        });
        context.acpSessionId = resumeSessionId;
      } else {
        const response = await this.sendRequest<Record<string, unknown>>(context, "session/new", {
          cwd: resolvedCwd,
          mcpServers: [],
        });
        const sessionId = readString(response, "sessionId");
        if (!sessionId) {
          throw new Error("session/new response did not include a sessionId.");
        }
        context.acpSessionId = sessionId;
      }

      await this.setSessionMode(context, runtimeModeToSessionMode(input.runtimeMode));

      this.updateSession(context, {
        status: "ready",
        ...(context.acpSessionId ? { resumeCursor: { threadId: context.acpSessionId } } : {}),
      });

      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "notification",
        provider: "gemini",
        threadId: context.session.threadId,
        createdAt: new Date().toISOString(),
        method: "thread/started",
        payload: {
          thread: {
            id: context.acpSessionId,
          },
        },
      });

      this.emitLifecycleEvent(
        context,
        "session/ready",
        `Connected to Gemini session ${context.acpSessionId ?? "unknown"}`,
      );

      await Effect.logInfo("gemini acp session ready", {
        threadId,
        sessionId: context.acpSessionId ?? null,
        model: context.session.model ?? null,
        runtimeMode: context.session.runtimeMode,
        resumed: resumeSessionId !== undefined,
      }).pipe(this.runPromise);

      return { ...context.session };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start Gemini session.";

      if (context) {
        this.updateSession(context, {
          status: "error",
          lastError: message,
        });
        this.emitErrorEvent(context, "session/startFailed", message);
        this.stopSession(threadId);
      } else {
        this.emitEvent({
          id: EventId.makeUnsafe(randomUUID()),
          kind: "error",
          provider: "gemini",
          threadId,
          createdAt: new Date().toISOString(),
          method: "session/startFailed",
          message,
        });
      }

      throw new Error(message, { cause: error });
    }
  }

  async sendTurn(input: GeminiAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    const context = this.requireSession(input.threadId);

    if (!context.acpSessionId) {
      throw new Error("Gemini session is missing an ACP session id.");
    }
    if (context.activeTurn) {
      throw new ProviderBusyError(input.threadId);
    }

    const requestedModel = normalizeGeminiModelSlug(input.model);
    if (requestedModel && context.session.model && requestedModel !== context.session.model) {
      throw new Error("Gemini model changes require restarting the session.");
    }

    const prompt = this.buildPrompt(input);
    if (prompt.length === 0) {
      throw new Error("Turn input must include text or attachments.");
    }

    const desiredMode =
      input.interactionMode === "plan"
        ? "plan"
        : runtimeModeToSessionMode(context.session.runtimeMode);
    await this.setSessionMode(context, desiredMode);

    const turnId = TurnId.makeUnsafe(randomUUID());
    const activeTurn: GeminiActiveTurnContext = {
      turnId,
      assistantItemId: ProviderItemId.makeUnsafe(randomUUID()),
      reasoningItemId: ProviderItemId.makeUnsafe(randomUUID()),
      planItemId: ProviderItemId.makeUnsafe(randomUUID()),
      toolItems: new Map(),
      startedItemIds: new Set(),
    };
    context.activeTurn = activeTurn;
    context.suppressUpdatesUntilTurn = false;
    context.turns.push({
      id: turnId,
      items: [],
    });

    this.updateSession(context, {
      status: "running",
      activeTurnId: turnId,
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "turn/started",
      turnId,
      payload: {
        turn: {
          id: turnId,
          ...(context.session.model ? { model: context.session.model } : {}),
          mode: desiredMode,
        },
      },
    });

    void this.sendRequest<Record<string, unknown>>(
      context,
      "session/prompt",
      {
        sessionId: context.acpSessionId,
        prompt,
      },
      PROMPT_TIMEOUT_MS,
    )
      .then((response) => {
        this.handlePromptCompleted(context, turnId, response);
      })
      .catch((error) => {
        this.handlePromptFailed(context, turnId, error);
      });

    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    };
  }

  async interruptTurn(threadId: ThreadId, turnId?: TurnId): Promise<void> {
    const context = this.requireSession(threadId);
    const activeTurnId = context.activeTurn?.turnId ?? context.session.activeTurnId;
    if (!activeTurnId || !context.acpSessionId) {
      return;
    }
    if (turnId && turnId !== activeTurnId) {
      return;
    }

    try {
      await this.sendRequest(
        context,
        "session/cancel",
        { sessionId: context.acpSessionId },
        10_000,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      if (message.includes("not currently generating")) {
        return;
      }
      throw error;
    }
  }

  async readThread(threadId: ThreadId): Promise<GeminiThreadSnapshot> {
    const context = this.requireSession(threadId);
    return {
      threadId: context.acpSessionId ?? context.session.threadId,
      turns: context.turns.map((turn) => ({
        id: turn.id,
        items: turn.items.map((item) =>
          typeof item === "object" && item !== null ? { ...item } : item,
        ),
      })),
    };
  }

  async rollbackThread(threadId: ThreadId, _numTurns: number): Promise<GeminiThreadSnapshot> {
    this.requireSession(threadId);
    throw new Error("Gemini ACP sessions do not support thread rollback.");
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const pendingRequest = context.pendingApprovals.get(requestId);
    if (!pendingRequest) {
      throw new Error(`Unknown pending approval request: ${requestId}`);
    }

    context.pendingApprovals.delete(requestId);

    const allowOnce = pendingRequest.options?.find((option) => option.kind === "allow_once");
    const allowAlways = pendingRequest.options?.find((option) => option.kind === "allow_always");
    const rejectOnce = pendingRequest.options?.find((option) => option.kind === "reject_once");

    const outcome =
      decision === "acceptForSession"
        ? (allowAlways ?? allowOnce)
        : decision === "accept"
          ? (allowOnce ?? allowAlways)
          : rejectOnce;

    if (decision === "decline" || decision === "cancel" || !outcome?.optionId) {
      this.writeMessage(context, {
        id: pendingRequest.jsonRpcId,
        result: {
          outcome: {
            outcome: "cancelled",
          },
        },
      });
    } else {
      this.writeMessage(context, {
        id: pendingRequest.jsonRpcId,
        result: {
          outcome: {
            outcome: "selected",
            optionId: outcome.optionId,
          },
        },
      });
    }

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/requestApproval/decision",
      ...(pendingRequest.turnId ? { turnId: pendingRequest.turnId } : {}),
      ...(pendingRequest.itemId ? { itemId: pendingRequest.itemId } : {}),
      requestId: pendingRequest.requestId,
      requestKind: pendingRequest.requestKind,
      payload: {
        requestId: pendingRequest.requestId,
        requestKind: pendingRequest.requestKind,
        decision,
      },
    });
  }

  async respondToUserInput(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const pendingRequest = context.pendingUserInputs.get(requestId);
    if (!pendingRequest) {
      throw new Error(`Unknown pending user input request: ${requestId}`);
    }

    context.pendingUserInputs.delete(requestId);
    const geminiAnswers = toGeminiUserInputAnswers(answers);
    this.writeMessage(context, {
      id: pendingRequest.jsonRpcId,
      result: {
        answers: geminiAnswers,
      },
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/tool/requestUserInput/answered",
      ...(pendingRequest.turnId ? { turnId: pendingRequest.turnId } : {}),
      ...(pendingRequest.itemId ? { itemId: pendingRequest.itemId } : {}),
      requestId: pendingRequest.requestId,
      payload: {
        requestId: pendingRequest.requestId,
        answers: geminiAnswers,
      },
    });
  }

  stopSession(threadId: ThreadId): void {
    const context = this.sessions.get(threadId);
    if (!context) {
      return;
    }

    context.stopping = true;

    for (const pending of context.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Session stopped before request completed."));
    }

    context.pending.clear();
    context.pendingApprovals.clear();
    context.pendingUserInputs.clear();
    context.output.close();

    if (!context.child.killed) {
      killChildTree(context.child);
    }

    this.updateSession(context, {
      status: "closed",
      activeTurnId: undefined,
    });
    this.emitLifecycleEvent(context, "session/closed", "Session stopped");
    this.sessions.delete(threadId);
  }

  listSessions(): ProviderSession[] {
    return Array.from(this.sessions.values(), ({ session }) => ({
      ...session,
    }));
  }

  hasSession(threadId: ThreadId): boolean {
    return this.sessions.has(threadId);
  }

  stopAll(): void {
    for (const threadId of this.sessions.keys()) {
      this.stopSession(threadId);
    }
  }

  private requireSession(threadId: ThreadId): GeminiSessionContext {
    const context = this.sessions.get(threadId);
    if (!context) {
      throw new Error(`Unknown session for thread: ${threadId}`);
    }
    if (context.session.status === "closed") {
      throw new Error(`Session is closed for thread: ${threadId}`);
    }
    return context;
  }

  private buildSpawnArgs(input: {
    runtimeMode: ProviderSession["runtimeMode"];
    model?: string;
  }): string[] {
    return [
      "--experimental-acp",
      "--approval-mode",
      runtimeModeToSessionMode(input.runtimeMode),
      ...(input.model ? ["--model", input.model] : []),
    ];
  }

  private buildPrompt(input: GeminiAppServerSendTurnInput): GeminiPromptPart[] {
    const prompt: GeminiPromptPart[] = [];

    if (input.input?.trim()) {
      prompt.push({
        type: "text",
        text: input.input,
      });
    }

    for (const attachment of input.attachments ?? []) {
      if (attachment.type !== "image") {
        continue;
      }
      const parsed = parseDataUrl(attachment.url);
      prompt.push({
        type: "image",
        mimeType: parsed.mimeType,
        data: parsed.data,
      });
    }

    return prompt;
  }

  private trackTurnItem(context: GeminiSessionContext, item: GeminiTurnItemSnapshot): void {
    const activeTurn = context.activeTurn;
    if (!activeTurn) {
      return;
    }
    const turn = context.turns.find((entry) => entry.id === activeTurn.turnId);
    if (!turn) {
      return;
    }

    const existingIndex = turn.items.findIndex((entry) => {
      const record = asObject(entry);
      return readString(record, "id") === item.id;
    });
    if (existingIndex >= 0) {
      turn.items[existingIndex] = cloneTurnItem(item);
      return;
    }
    turn.items.push(cloneTurnItem(item));
  }

  private ensureItemStarted(
    context: GeminiSessionContext,
    itemId: ProviderItemId,
    turnId: TurnId,
    itemType: string,
    payloadItem: Record<string, unknown>,
  ): void {
    const activeTurn = context.activeTurn;
    if (!activeTurn || activeTurn.startedItemIds.has(itemId)) {
      return;
    }

    activeTurn.startedItemIds.add(itemId);
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/started",
      turnId,
      itemId,
      payload: {
        item: {
          id: itemId,
          type: itemType,
          ...payloadItem,
        },
      },
    });
  }

  private emitItemCompleted(
    context: GeminiSessionContext,
    turnId: TurnId,
    item: GeminiTurnItemSnapshot,
  ): void {
    const activeTurn = context.activeTurn;
    if (!activeTurn || !activeTurn.startedItemIds.has(item.id)) {
      return;
    }

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/completed",
      turnId,
      itemId: item.id,
      payload: {
        item: {
          id: item.id,
          type: item.type,
          ...(item.title ? { title: item.title } : {}),
          ...(item.detail ? { summary: item.detail } : {}),
          ...(item.status ? { status: item.status } : {}),
        },
      },
    });
  }

  private handlePromptCompleted(
    context: GeminiSessionContext,
    turnId: TurnId,
    response: Record<string, unknown>,
  ): void {
    if (context.stopping || context.activeTurn?.turnId !== turnId) {
      return;
    }

    const stopReason = asString(response.stopReason) ?? "end_turn";
    this.finishTurn(context, turnId, {
      status: stopReason === "cancelled" ? "cancelled" : "completed",
      stopReason,
    });
  }

  private handlePromptFailed(context: GeminiSessionContext, turnId: TurnId, error: unknown): void {
    if (context.stopping || context.activeTurn?.turnId !== turnId) {
      return;
    }

    const message = error instanceof Error ? error.message : "Gemini prompt failed.";
    this.emitErrorEvent(context, "turn/failed", message);
    this.finishTurn(context, turnId, {
      status: "failed",
      stopReason: "error",
      errorMessage: message,
    });
  }

  private finishTurn(
    context: GeminiSessionContext,
    turnId: TurnId,
    input: {
      status: "completed" | "failed" | "cancelled";
      stopReason: string;
      errorMessage?: string;
    },
  ): void {
    const activeTurn = context.activeTurn;
    if (!activeTurn || activeTurn.turnId !== turnId) {
      return;
    }

    const assistantItem =
      this.findTrackedTurnItem(context, turnId, activeTurn.assistantItemId) ??
      ({
        id: activeTurn.assistantItemId,
        type: "agentMessage",
        status: "completed",
      } satisfies GeminiTurnItemSnapshot);
    if (activeTurn.startedItemIds.has(activeTurn.assistantItemId)) {
      this.emitItemCompleted(context, turnId, assistantItem);
    }
    const reasoningItem =
      this.findTrackedTurnItem(context, turnId, activeTurn.reasoningItemId) ??
      ({
        id: activeTurn.reasoningItemId,
        type: "reasoning",
        status: "completed",
      } satisfies GeminiTurnItemSnapshot);
    if (activeTurn.startedItemIds.has(activeTurn.reasoningItemId)) {
      this.emitItemCompleted(context, turnId, reasoningItem);
    }
    const planItem =
      this.findTrackedTurnItem(context, turnId, activeTurn.planItemId) ??
      ({
        id: activeTurn.planItemId,
        type: "plan",
        status: "completed",
      } satisfies GeminiTurnItemSnapshot);
    if (activeTurn.startedItemIds.has(activeTurn.planItemId)) {
      this.emitItemCompleted(context, turnId, planItem);
    }
    for (const item of activeTurn.toolItems.values()) {
      this.emitItemCompleted(context, turnId, item);
    }

    this.updateSession(context, {
      status: input.status === "failed" ? "error" : "ready",
      activeTurnId: undefined,
      ...(input.errorMessage ? { lastError: input.errorMessage } : {}),
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "turn/completed",
      turnId,
      payload: {
        turn: {
          id: turnId,
          status: input.status,
          stopReason: input.stopReason,
          ...(input.errorMessage
            ? {
                error: {
                  message: input.errorMessage,
                },
              }
            : {}),
        },
      },
    });

    delete context.activeTurn;
  }

  private findTrackedTurnItem(
    context: GeminiSessionContext,
    turnId: TurnId,
    itemId: ProviderItemId,
  ): GeminiTurnItemSnapshot | undefined {
    const turn = context.turns.find((entry) => entry.id === turnId);
    if (!turn) {
      return undefined;
    }
    return turn.items.find((entry) => {
      const record = asObject(entry);
      return readString(record, "id") === itemId;
    }) as GeminiTurnItemSnapshot | undefined;
  }

  private async setSessionMode(
    context: GeminiSessionContext,
    modeId: "default" | "yolo" | "plan",
  ): Promise<void> {
    if (!context.acpSessionId) {
      return;
    }
    await this.sendRequest(
      context,
      "session/set_mode",
      {
        sessionId: context.acpSessionId,
        modeId,
      },
      20_000,
    );
  }

  private attachProcessListeners(context: GeminiSessionContext): void {
    attachGeminiTransportListeners(context, {
      onStdoutLine: (line) => {
        this.handleStdoutLine(context, line);
      },
      onStderrMessage: (message) => {
        this.emitErrorEvent(context, "process/stderr", message);
      },
      onProcessError: (error) => {
        const message = error.message || "Gemini ACP process errored.";
        this.updateSession(context, {
          status: "error",
          lastError: message,
          activeTurnId: undefined,
        });
        if (context.activeTurn) {
          this.finishTurn(context, context.activeTurn.turnId, {
            status: "failed",
            stopReason: "process_error",
            errorMessage: message,
          });
        }
        this.emitErrorEvent(context, "process/error", message);
      },
      onExit: (code, signal) => {
        if (context.stopping) {
          return;
        }

        const message = `Gemini ACP exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
        if (context.activeTurn) {
          this.finishTurn(context, context.activeTurn.turnId, {
            status: "failed",
            stopReason: "process_exit",
            errorMessage: message,
          });
        }
        this.updateSession(context, {
          status: "closed",
          activeTurnId: undefined,
          lastError: code === 0 ? context.session.lastError : message,
        });
        this.emitLifecycleEvent(context, "session/exited", message);
        this.sessions.delete(context.session.threadId);
      },
    });
  }

  private handleStdoutLine(context: GeminiSessionContext, line: string): void {
    routeGeminiProtocolLine(line, {
      onRequest: (request) => {
        this.handleServerRequest(
          context,
          request as {
            id: string | number;
            method: string;
            params?: unknown;
          },
        );
      },
      onNotification: (notification) => {
        this.handleServerNotification(context, notification);
      },
      onResponse: (response) => {
        this.handleResponse(context, response);
      },
      onProtocolError: (method, message) => {
        this.emitErrorEvent(context, method, message);
      },
    });
  }

  private handleServerNotification(
    context: GeminiSessionContext,
    notification: JsonRpcNotification,
  ): void {
    if (notification.method !== "session/update") {
      return;
    }

    const params = asObject(notification.params);
    if (!params) {
      return;
    }
    const sessionId = asString(params.sessionId);
    if (sessionId && context.acpSessionId && sessionId !== context.acpSessionId) {
      return;
    }

    const update = asObject(params.update);
    const activeTurn = context.activeTurn;
    if (!update || !activeTurn || context.suppressUpdatesUntilTurn) {
      return;
    }

    const sessionUpdate = asString(update.sessionUpdate);
    if (!sessionUpdate) {
      return;
    }

    if (sessionUpdate === "agent_message_chunk") {
      const delta = asString(asObject(update.content)?.text);
      if (!delta) {
        return;
      }

      const item: GeminiTurnItemSnapshot = {
        id: activeTurn.assistantItemId,
        type: "agentMessage",
        status: "in_progress",
      };
      this.trackTurnItem(context, item);
      this.ensureItemStarted(context, item.id, activeTurn.turnId, item.type, {});
      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "notification",
        provider: "gemini",
        threadId: context.session.threadId,
        createdAt: new Date().toISOString(),
        method: "item/agentMessage/delta",
        turnId: activeTurn.turnId,
        itemId: item.id,
        textDelta: delta,
        payload: {
          item: {
            id: item.id,
            type: item.type,
          },
          delta,
        },
      });
      return;
    }

    if (sessionUpdate === "agent_thought_chunk") {
      const delta = asString(asObject(update.content)?.text);
      if (!delta) {
        return;
      }

      const item: GeminiTurnItemSnapshot = {
        id: activeTurn.reasoningItemId,
        type: "reasoning",
        status: "in_progress",
      };
      this.trackTurnItem(context, item);
      this.ensureItemStarted(context, item.id, activeTurn.turnId, item.type, {});
      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "notification",
        provider: "gemini",
        threadId: context.session.threadId,
        createdAt: new Date().toISOString(),
        method: "item/reasoning/textDelta",
        turnId: activeTurn.turnId,
        itemId: item.id,
        textDelta: delta,
        payload: {
          item: {
            id: item.id,
            type: item.type,
          },
          delta,
        },
      });
      return;
    }

    if (sessionUpdate === "plan") {
      const entries = asArray(update.entries) ?? [];
      const plan = entries
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== undefined)
        .map((entry) => ({
          step: asString(entry.content) ?? "step",
          status:
            entry.status === "completed" || entry.status === "in_progress"
              ? entry.status === "in_progress"
                ? "inProgress"
                : "completed"
              : "pending",
        }));

      const item: GeminiTurnItemSnapshot = {
        id: activeTurn.planItemId,
        type: "plan",
        status: "in_progress",
        detail: plan.map((entry) => `- ${entry.step}`).join("\n"),
      };
      this.trackTurnItem(context, item);
      this.ensureItemStarted(context, item.id, activeTurn.turnId, item.type, {
        summary: item.detail,
      });
      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "notification",
        provider: "gemini",
        threadId: context.session.threadId,
        createdAt: new Date().toISOString(),
        method: "turn/plan/updated",
        turnId: activeTurn.turnId,
        itemId: item.id,
        payload: {
          plan,
        },
      });
      return;
    }

    if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
      const toolCall = update as GeminiAcpToolCall & Record<string, unknown>;
      const toolCallId = asString(toolCall.toolCallId);
      if (!toolCallId) {
        return;
      }

      const existingItem = activeTurn.toolItems.get(toolCallId);
      const title = asString(toolCall.title) ?? existingItem?.title;
      const detail =
        textFromToolContent(toolCall.content) ?? existingItem?.detail ?? asString(toolCall.title);
      const status = toolCall.status ?? existingItem?.status;
      const item: GeminiTurnItemSnapshot = {
        id: existingItem?.id ?? ProviderItemId.makeUnsafe(randomUUID()),
        type: existingItem?.type ?? providerItemTypeFromToolCall(toolCall),
        ...(title ? { title } : {}),
        ...(status ? { status } : {}),
        ...(detail ? { detail } : {}),
        toolCallId,
        ...(toolCall.content ? { content: toolCall.content } : {}),
      };
      activeTurn.toolItems.set(toolCallId, item);
      this.trackTurnItem(context, item);
      this.ensureItemStarted(context, item.id, activeTurn.turnId, item.type, {
        ...(item.title ? { title: item.title } : {}),
        ...(item.detail ? { summary: item.detail } : {}),
        ...(pathFromToolContent(toolCall.content)
          ? { path: pathFromToolContent(toolCall.content) }
          : {}),
      });

      const textDelta = textFromToolContent(toolCall.content);
      const outputMethod = outputDeltaMethodFromItemType(item.type);
      if (textDelta && outputMethod) {
        this.emitEvent({
          id: EventId.makeUnsafe(randomUUID()),
          kind: "notification",
          provider: "gemini",
          threadId: context.session.threadId,
          createdAt: new Date().toISOString(),
          method: outputMethod,
          turnId: activeTurn.turnId,
          itemId: item.id,
          textDelta,
          payload: {
            item: {
              id: item.id,
              type: item.type,
            },
            delta: textDelta,
          },
        });
      }

      if (item.status === "completed" || item.status === "failed") {
        this.emitItemCompleted(context, activeTurn.turnId, item);
      }
    }
  }

  private handleServerRequest(
    context: GeminiSessionContext,
    request: { id: string | number; method: string; params?: unknown },
  ): void {
    if (request.method !== "session/request_permission") {
      this.writeMessage(context, {
        id: request.id,
        error: {
          code: -32601,
          message: `Unsupported Gemini ACP request: ${request.method}`,
        },
      });
      return;
    }

    const params = asObject(request.params);
    const activeTurn = context.activeTurn;
    if (!params || !activeTurn) {
      this.writeMessage(context, {
        id: request.id,
        error: {
          code: -32000,
          message: "Gemini ACP requested permission without an active turn.",
        },
      });
      return;
    }

    const toolCall = asObject(params.toolCall);
    const options = (asArray(params.options) ?? [])
      .map((entry) => asObject(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined)
      .map((entry) => ({
        optionId: asString(entry.optionId) ?? "",
        kind: asString(entry.kind) ?? "",
        name: asString(entry.name) ?? "",
      }))
      .filter((entry) => entry.optionId.length > 0);

    const binding = requestBindingFromToolKind(asString(toolCall?.kind));
    const toolCallId = asString(toolCall?.toolCallId);
    const existingItem = toolCallId ? activeTurn.toolItems.get(toolCallId) : undefined;
    const itemId =
      existingItem?.id ?? ProviderItemId.makeUnsafe(asString(toolCall?.toolCallId) ?? randomUUID());
    if (toolCallId && !existingItem) {
      const title = asString(toolCall?.title);
      const detail =
        textFromToolContent(toolCall?.content as GeminiAcpToolContent[]) ??
        asString(toolCall?.title);
      const item: GeminiTurnItemSnapshot = {
        id: itemId,
        type: providerItemTypeFromToolCall(toolCall as GeminiAcpToolCall),
        status: "pending",
        ...(title ? { title } : {}),
        ...(detail ? { detail } : {}),
        toolCallId,
        ...(toolCall?.content ? { content: toolCall.content as GeminiAcpToolContent[] } : {}),
      };
      activeTurn.toolItems.set(toolCallId, item);
      this.trackTurnItem(context, item);
    }

    const requestId = ApprovalRequestId.makeUnsafe(randomUUID());
    context.pendingApprovals.set(requestId, {
      requestId,
      jsonRpcId: request.id,
      method: binding.method,
      requestKind: binding.requestKind,
      threadId: context.session.threadId,
      turnId: activeTurn.turnId,
      itemId,
      options,
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "request",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: binding.method,
      turnId: activeTurn.turnId,
      itemId,
      requestId,
      requestKind: binding.requestKind,
      payload: {
        toolCall,
        options,
        title: asString(toolCall?.title),
        command: asString(toolCall?.title),
      },
    });
  }

  private handleResponse(context: GeminiSessionContext, response: JsonRpcResponse): void {
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

  private async sendRequest<TResponse>(
    context: GeminiSessionContext,
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<TResponse> {
    return sendJsonRpcRequest<TResponse>(context, method, params, timeoutMs);
  }

  private writeMessage(context: GeminiSessionContext, message: unknown): void {
    writeJsonRpcMessage(context, message);
  }

  private emitLifecycleEvent(context: GeminiSessionContext, method: string, message: string): void {
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "session",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      message,
    });
  }

  private emitErrorEvent(context: GeminiSessionContext, method: string, message: string): void {
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "error",
      provider: "gemini",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      message,
    });
  }

  private emitEvent(event: ProviderEvent): void {
    this.emit("event", emitProviderEvent(event));
  }

  private assertSupportedGeminiCliVersion(input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly homePath?: string;
  }): void {
    assertSupportedGeminiCliVersion(input);
  }

  private updateSession(context: GeminiSessionContext, updates: Partial<ProviderSession>): void {
    updateSession(context, updates);
  }
}
