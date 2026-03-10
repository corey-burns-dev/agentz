/**
 * ClaudeCodeAppServerManager
 *
 * Manages Claude Code CLI sessions by spawning `claude -p --output-format stream-json`
 * as a per-turn subprocess. Session continuity is maintained via --resume <session_id>
 * using the Claude CLI's own session persistence (~/.claude/projects/).
 *
 * Protocol differences from Codex/Gemini:
 * - No persistent JSON-RPC daemon; a fresh subprocess is spawned per turn.
 * - Output is NDJSON (not JSON-RPC) on stdout.
 * - Session identity comes from the `system/init` message's `session_id` field.
 * - Tool approvals use a lightweight control_request/control_response protocol on stdin.
 *
 * @module claudeCodeAppServerManager
 */
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
  asObject,
  asString,
  buildControlAllowResponse,
  buildControlBlockResponse,
  buildControlInitializeMessage,
  buildPermissionFlags,
  classifyClaudeCodeStderrLine,
  detailFromToolInput,
  itemTypeFromToolName,
  killChildTree,
  normalizeClaudeCodeModelSlug,
  pathFromToolInput,
  requestKindFromToolName,
} from "./claudeCodeAppServerHelpers";
import {
  assertSupportedClaudeCodeCliVersion,
  buildClaudeCodeEnvironment,
  type ClaudeCodeActiveTurnContext,
  type ClaudeCodeAppServerSendTurnInput,
  type ClaudeCodeAppServerStartSessionInput,
  type ClaudeCodeSessionContext,
  type ClaudeCodeThreadSnapshot,
  type ClaudeCodeToolItemContext,
  type ContentBlockContext,
  type PendingApprovalRequest,
  readClaudeCodeProviderOptions,
  readResumeClaudeSessionId,
  updateSession,
} from "./claudeCodeAppServerSession";
import { ProviderBusyError } from "./provider/providerBusyError";

export type {
  ClaudeCodeAppServerSendTurnInput,
  ClaudeCodeAppServerStartSessionInput,
} from "./claudeCodeAppServerSession";

// ── Constants ──────────────────────────────────────────────────────────

const TURN_TIMEOUT_MS = 20 * 60_000; // 20 minutes

// ── Event types ────────────────────────────────────────────────────────

export interface ClaudeCodeAppServerManagerEvents {
  event: [event: ProviderEvent];
}

// ── Manager ────────────────────────────────────────────────────────────

export class ClaudeCodeAppServerManager extends EventEmitter<ClaudeCodeAppServerManagerEvents> {
  private readonly sessions = new Map<ThreadId, ClaudeCodeSessionContext>();

  private readonly runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>;

  constructor(services?: ServiceMap.ServiceMap<never>) {
    super();
    this.runPromise = services ? Effect.runPromiseWith(services) : Effect.runPromise;
  }

  async startSession(input: ClaudeCodeAppServerStartSessionInput): Promise<ProviderSession> {
    const threadId = input.threadId;
    const now = new Date().toISOString();

    try {
      const resolvedCwd = resolvePath(input.cwd ?? process.cwd());
      const model = normalizeClaudeCodeModelSlug(input.model);
      const claudeCodeOptions = readClaudeCodeProviderOptions(input);
      const claudeBinaryPath = claudeCodeOptions.binaryPath ?? "claude";

      assertSupportedClaudeCodeCliVersion({
        binaryPath: claudeBinaryPath,
        cwd: resolvedCwd,
        ...(claudeCodeOptions.homePath ? { homePath: claudeCodeOptions.homePath } : {}),
      });

      const resumeClaudeSessionId = readResumeClaudeSessionId(input);

      const context: ClaudeCodeSessionContext = {
        session: {
          provider: "claude-code",
          status: "connecting",
          runtimeMode: input.runtimeMode,
          ...(model ? { model } : {}),
          cwd: resolvedCwd,
          threadId,
          createdAt: now,
          updatedAt: now,
        },
        providerOptions: claudeCodeOptions,
        ...(resumeClaudeSessionId ? { claudeSessionId: resumeClaudeSessionId } : {}),
        turns: [],
        stopping: false,
      };

      this.sessions.set(threadId, context);

      this.emitLifecycleEvent(context, "session/connecting", "Starting Claude Code session");

      updateSession(context, {
        status: "ready",
        ...(resumeClaudeSessionId
          ? { resumeCursor: { claudeSessionId: resumeClaudeSessionId } }
          : {}),
      });

      this.emitLifecycleEvent(
        context,
        "session/ready",
        resumeClaudeSessionId
          ? `Resuming Claude Code session ${resumeClaudeSessionId}`
          : "Claude Code session ready",
      );

      if (resumeClaudeSessionId) {
        // Emit thread/started so the UI picks up the resume cursor
        this.emitEvent({
          id: EventId.makeUnsafe(randomUUID()),
          kind: "notification",
          provider: "claude-code",
          threadId: context.session.threadId,
          createdAt: new Date().toISOString(),
          method: "thread/started",
          payload: { thread: { id: resumeClaudeSessionId } },
        });
      }

      await Effect.logInfo("claude code session ready", {
        threadId,
        claudeSessionId: resumeClaudeSessionId ?? null,
        model: context.session.model ?? null,
        runtimeMode: context.session.runtimeMode,
        resumed: resumeClaudeSessionId !== undefined,
      }).pipe(this.runPromise);

      return { ...context.session };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start Claude Code session.";

      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "error",
        provider: "claude-code",
        threadId,
        createdAt: new Date().toISOString(),
        method: "session/startFailed",
        message,
      });

      const existingContext = this.sessions.get(threadId);
      if (existingContext) {
        updateSession(existingContext, { status: "error", lastError: message });
        this.sessions.delete(threadId);
      }

      throw new Error(message, { cause: error });
    }
  }

  async sendTurn(input: ClaudeCodeAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    const context = this.requireSession(input.threadId);

    if (context.activeTurn) {
      throw new ProviderBusyError(input.threadId);
    }

    if (!input.input?.trim()) {
      throw new Error("Turn input must include text.");
    }

    const turnId = TurnId.makeUnsafe(randomUUID());
    const claudeCodeOptions = context.providerOptions;
    const claudeBinaryPath = claudeCodeOptions.binaryPath ?? "claude";
    const resolvedCwd = context.session.cwd ?? process.cwd();

    // Build args
    const useControlProtocol = context.session.runtimeMode === "approval-required";
    const resolvedModel = normalizeClaudeCodeModelSlug(input.model) ?? context.session.model;
    const args = this.buildSpawnArgs({
      runtimeMode: context.session.runtimeMode,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(context.claudeSessionId ? { claudeSessionId: context.claudeSessionId } : {}),
      useControlProtocol,
      prompt: input.input.trim(),
    });

    const child = spawn(claudeBinaryPath, args, {
      cwd: resolvedCwd,
      env: buildClaudeCodeEnvironment(
        {
          ...process.env,
          // Prevent nested session detection from blocking the CLI.
          CLAUDECODE: undefined,
          CLAUDE_CODE_ENTRYPOINT: undefined,
        },
        claudeCodeOptions.homePath,
      ),
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    const output = readline.createInterface({ input: child.stdout });

    const activeTurn: ClaudeCodeActiveTurnContext = {
      turnId,
      child: child as ChildProcessWithoutNullStreams,
      output,
      assistantItemId: ProviderItemId.makeUnsafe(randomUUID()),
      reasoningItemId: ProviderItemId.makeUnsafe(randomUUID()),
      assistantTextStreamed: false,
      reasoningTextStreamed: false,
      assistantMessageText: "",
      reasoningMessageText: "",
      contentBlocks: new Map(),
      toolItems: new Map(),
      startedItemIds: new Set(),
      pendingApprovals: new Map(),
      controlInitialized: false,
    };

    context.activeTurn = activeTurn;
    context.turns.push({ id: turnId, items: [] });

    updateSession(context, { status: "running", activeTurnId: turnId });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "turn/started",
      turnId,
      payload: {
        turn: {
          id: turnId,
          ...(context.session.model ? { model: context.session.model } : {}),
          mode: input.interactionMode ?? "default",
        },
      },
    });

    // Attach process listeners
    this.attachTurnListeners(context, activeTurn, turnId, useControlProtocol);

    // Send control initialize if using control protocol
    if (useControlProtocol) {
      const initMsg = buildControlInitializeMessage("ctrl_init_0");
      try {
        child.stdin.write(`${initMsg}\n`);
      } catch {
        // stdin may not be writable yet; best effort
      }
    } else {
      // Close stdin for non-control-protocol turns (no input expected)
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
    }

    // Set a global turn timeout
    const turnTimeout = setTimeout(() => {
      if (context.activeTurn?.turnId === turnId) {
        this.handleTurnFailed(context, turnId, "Turn timed out.");
        killChildTree(child as ChildProcessWithoutNullStreams);
      }
    }, TURN_TIMEOUT_MS);
    // Ensure the timeout doesn't keep the process alive
    turnTimeout.unref?.();

    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    };
  }

  async interruptTurn(threadId: ThreadId, turnId?: TurnId): Promise<void> {
    const context = this.sessions.get(threadId);
    if (!context?.activeTurn) {
      return;
    }

    const activeTurnId = context.activeTurn.turnId ?? context.session.activeTurnId;
    if (turnId && turnId !== activeTurnId) {
      return;
    }

    killChildTree(context.activeTurn.child);
  }

  async readThread(threadId: ThreadId): Promise<ClaudeCodeThreadSnapshot> {
    const context = this.requireSession(threadId);
    return {
      threadId: context.claudeSessionId ?? context.session.threadId,
      turns: context.turns.map((turn) => ({
        id: turn.id,
        items: [...turn.items],
      })),
    };
  }

  async rollbackThread(threadId: ThreadId, _numTurns: number): Promise<ClaudeCodeThreadSnapshot> {
    this.requireSession(threadId);
    throw new Error("Claude Code sessions do not support thread rollback.");
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const activeTurn = context.activeTurn;
    if (!activeTurn) {
      throw new Error(`No active turn for thread: ${threadId}`);
    }

    const pendingRequest = activeTurn.pendingApprovals.get(requestId);
    if (!pendingRequest) {
      throw new Error(`Unknown pending approval request: ${requestId}`);
    }

    activeTurn.pendingApprovals.delete(requestId);

    const isApproved = decision === "accept" || decision === "acceptForSession";

    const response = isApproved
      ? buildControlAllowResponse(pendingRequest.claudeRequestId)
      : buildControlBlockResponse(pendingRequest.claudeRequestId, "Permission denied.");

    try {
      activeTurn.child.stdin.write(`${response}\n`);
    } catch {
      // stdin may have closed if the turn already ended
    }

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "claude-code",
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
    _requestId: ApprovalRequestId,
    _answers: ProviderUserInputAnswers,
  ): Promise<void> {
    this.requireSession(threadId);
    throw new Error("Claude Code sessions do not support structured user input responses.");
  }

  stopSession(threadId: ThreadId): void {
    const context = this.sessions.get(threadId);
    if (!context) {
      return;
    }

    context.stopping = true;

    if (context.activeTurn) {
      killChildTree(context.activeTurn.child);
      context.activeTurn.output.close();
      delete context.activeTurn;
    }

    updateSession(context, { status: "closed", activeTurnId: undefined });
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

  // ── Private helpers ────────────────────────────────────────────────

  private requireSession(threadId: ThreadId): ClaudeCodeSessionContext {
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
    claudeSessionId?: string;
    useControlProtocol: boolean;
    prompt: string;
  }): string[] {
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...buildPermissionFlags(input.runtimeMode),
      ...(input.claudeSessionId ? ["--resume", input.claudeSessionId] : []),
      ...(input.model ? ["--model", input.model] : []),
      "--",
      input.prompt,
    ];
  }

  private attachTurnListeners(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    useControlProtocol: boolean,
  ): void {
    const { child, output } = activeTurn;

    output.on("line", (line: string) => {
      this.handleStdoutLine(context, activeTurn, turnId, line, useControlProtocol);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const raw = chunk.toString();
      for (const rawLine of raw.split(/\r?\n/g)) {
        const classified = classifyClaudeCodeStderrLine(rawLine);
        if (!classified) continue;
        this.emitErrorEvent(context, "process/stderr", classified.message, turnId);
      }
    });

    child.on("error", (error) => {
      if (context.activeTurn?.turnId !== turnId) return;
      const message = error.message || "Claude Code process errored.";
      this.handleTurnFailed(context, turnId, message);
    });

    child.on("exit", (code, signal) => {
      if (context.stopping) return;
      if (context.activeTurn?.turnId !== turnId) return;

      output.close();

      // If the turn already completed via a `result` message, the activeTurn
      // should have been cleared. If it's still set, the process exited unexpectedly.
      if (context.activeTurn) {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          this.finishTurn(context, turnId, {
            status: "cancelled",
            stopReason: "interrupted",
          });
        } else {
          const message = `Claude Code exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
          this.handleTurnFailed(context, turnId, message);
        }
      }
    });
  }

  private handleStdoutLine(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    line: string,
    useControlProtocol: boolean,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON line; ignore
      return;
    }

    const msg = asObject(parsed);
    if (!msg) return;

    const type = asString(msg.type);
    if (!type) return;

    switch (type) {
      case "system":
        this.handleSystemMessage(context, activeTurn, msg);
        break;
      case "stream_event":
        this.handleStreamEvent(context, activeTurn, turnId, msg);
        break;
      case "assistant":
        this.handleAssistantMessage(context, activeTurn, turnId, msg);
        break;
      case "user":
        this.handleUserMessage(context, activeTurn, turnId, msg);
        break;
      case "result":
        this.handleResultMessage(context, activeTurn, turnId, msg);
        break;
      case "control_request":
        if (useControlProtocol) {
          this.handleControlRequest(context, activeTurn, turnId, msg);
        }
        break;
      case "control_response":
        // Responses from the CLI confirming our sent control_requests
        if (asString(msg.request_id) === "ctrl_init_0") {
          activeTurn.controlInitialized = true;
        }
        break;
      default:
        break;
    }
  }

  private handleSystemMessage(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    msg: Record<string, unknown>,
  ): void {
    const subtype = asString(msg.subtype);
    if (subtype !== "init") return;

    const sessionId = asString(msg.session_id);
    if (!sessionId) return;

    // Only emit thread/started on the first turn (when we don't have a sessionId yet)
    const isFirstTurn = !context.claudeSessionId;
    context.claudeSessionId = sessionId;

    updateSession(context, {
      resumeCursor: { claudeSessionId: sessionId },
    });

    if (isFirstTurn) {
      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "notification",
        provider: "claude-code",
        threadId: context.session.threadId,
        createdAt: new Date().toISOString(),
        method: "thread/started",
        turnId: activeTurn.turnId,
        payload: { thread: { id: sessionId } },
      });
    }
  }

  private handleStreamEvent(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    msg: Record<string, unknown>,
  ): void {
    const streamEvent = asObject(msg.stream_event);
    if (!streamEvent) return;

    const eventType = asString(streamEvent.type);
    if (!eventType) return;

    const index = typeof streamEvent.index === "number" ? streamEvent.index : -1;

    switch (eventType) {
      case "content_block_start": {
        const block = asObject(streamEvent.content_block);
        if (!block) return;
        const blockType = asString(block.type);
        if (!blockType) return;

        if (blockType === "text") {
          const ctx: ContentBlockContext = {
            index,
            type: "text",
            itemId: activeTurn.assistantItemId,
          };
          activeTurn.contentBlocks.set(index, ctx);
          this.ensureItemStarted(
            context,
            activeTurn,
            turnId,
            activeTurn.assistantItemId,
            "agentMessage",
            {},
          );
        } else if (blockType === "thinking") {
          const ctx: ContentBlockContext = {
            index,
            type: "thinking",
            itemId: activeTurn.reasoningItemId,
          };
          activeTurn.contentBlocks.set(index, ctx);
          this.ensureItemStarted(
            context,
            activeTurn,
            turnId,
            activeTurn.reasoningItemId,
            "reasoning",
            {},
          );
        } else if (blockType === "tool_use") {
          const toolUseId = asString(block.id) ?? randomUUID();
          const toolName = asString(block.name) ?? "unknown";
          const itemId = ProviderItemId.makeUnsafe(randomUUID());
          const ctx: ContentBlockContext = {
            index,
            type: "tool_use",
            itemId,
            toolUseId,
            toolName,
          };
          activeTurn.contentBlocks.set(index, ctx);
          // We'll emit item/started after the full assistant message arrives
          // with the complete input. Track the item now.
          const toolCtx: ClaudeCodeToolItemContext = {
            itemId,
            toolUseId,
            toolName,
            itemType: itemTypeFromToolName(toolName),
          };
          activeTurn.toolItems.set(toolUseId, toolCtx);
        }
        break;
      }

      case "content_block_delta": {
        const delta = asObject(streamEvent.delta);
        if (!delta) return;
        const deltaType = asString(delta.type);
        const blockCtx = activeTurn.contentBlocks.get(index);
        if (!blockCtx) return;

        if (deltaType === "text_delta") {
          const text = asString(delta.text);
          if (!text) return;
          activeTurn.assistantTextStreamed = true;
          this.emitTextDelta(
            context,
            activeTurn,
            turnId,
            activeTurn.assistantItemId,
            "agentMessage",
            "item/agentMessage/delta",
            text,
          );
        } else if (deltaType === "thinking_delta") {
          const thinking = asString(delta.thinking);
          if (!thinking) return;
          activeTurn.reasoningTextStreamed = true;
          this.emitTextDelta(
            context,
            activeTurn,
            turnId,
            activeTurn.reasoningItemId,
            "reasoning",
            "item/reasoning/textDelta",
            thinking,
          );
        }
        break;
      }

      case "content_block_stop": {
        const blockCtx = activeTurn.contentBlocks.get(index);
        if (!blockCtx) return;

        if (blockCtx.type === "text") {
          this.emitItemCompleted(context, activeTurn, turnId, {
            id: blockCtx.itemId,
            type: "agentMessage",
            status: "completed",
          });
        } else if (blockCtx.type === "thinking") {
          this.emitItemCompleted(context, activeTurn, turnId, {
            id: blockCtx.itemId,
            type: "reasoning",
            status: "completed",
          });
        }
        // tool_use items are completed when the tool_result arrives
        activeTurn.contentBlocks.delete(index);
        break;
      }

      default:
        break;
    }
  }

  private handleAssistantMessage(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    msg: Record<string, unknown>,
  ): void {
    const message = asObject(msg.message);
    if (!message) return;

    const content = Array.isArray(message.content) ? (message.content as unknown[]) : [];
    const assistantTextParts: string[] = [];
    const reasoningTextParts: string[] = [];

    for (const block of content) {
      const blockRecord = asObject(block);
      if (!blockRecord) continue;
      const blockType = asString(blockRecord.type);

      if (blockType === "text") {
        const text = asString(blockRecord.text);
        if (text && !activeTurn.assistantTextStreamed) {
          assistantTextParts.push(text);
        }
        continue;
      }

      if (blockType === "thinking") {
        const thinking = asString(blockRecord.thinking);
        if (thinking && !activeTurn.reasoningTextStreamed) {
          reasoningTextParts.push(thinking);
        }
        continue;
      }

      if (blockType !== "tool_use") {
        continue;
      }

      const toolUseId = asString(blockRecord.id);
      const toolName = asString(blockRecord.name) ?? "unknown";
      const toolInput = blockRecord.input;

      if (!toolUseId) continue;

      let toolCtx = activeTurn.toolItems.get(toolUseId);
      if (!toolCtx) {
        const itemId = ProviderItemId.makeUnsafe(randomUUID());
        toolCtx = {
          itemId,
          toolUseId,
          toolName,
          itemType: itemTypeFromToolName(toolName),
          input: toolInput,
        };
        activeTurn.toolItems.set(toolUseId, toolCtx);
      } else {
        toolCtx.input = toolInput;
      }

      const detail = detailFromToolInput(toolName, toolInput);
      const path = pathFromToolInput(toolName, toolInput);

      this.ensureItemStarted(context, activeTurn, turnId, toolCtx.itemId, toolCtx.itemType, {
        ...(toolName ? { title: toolName } : {}),
        ...(detail ? { summary: detail } : {}),
        ...(path ? { path } : {}),
      });
    }

    if (assistantTextParts.length > 0) {
      this.emitMessageSnapshotText(
        context,
        activeTurn,
        turnId,
        "assistant",
        assistantTextParts.join(""),
      );
    }

    if (reasoningTextParts.length > 0) {
      this.emitMessageSnapshotText(
        context,
        activeTurn,
        turnId,
        "reasoning",
        reasoningTextParts.join(""),
      );
    }
  }

  private handleUserMessage(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    msg: Record<string, unknown>,
  ): void {
    const message = asObject(msg.message);
    if (!message) return;

    const content = Array.isArray(message.content) ? (message.content as unknown[]) : [];

    for (const block of content) {
      const blockRecord = asObject(block);
      if (!blockRecord) continue;
      const blockType = asString(blockRecord.type);

      if (blockType === "tool_result") {
        const toolUseId = asString(blockRecord.tool_use_id);
        if (!toolUseId) continue;

        const toolCtx = activeTurn.toolItems.get(toolUseId);
        if (!toolCtx) continue;

        const resultContent = blockRecord.content;
        const summary = typeof resultContent === "string" ? resultContent.slice(0, 200) : undefined;

        this.emitItemCompleted(context, activeTurn, turnId, {
          id: toolCtx.itemId,
          type: toolCtx.itemType,
          status: "completed",
          ...(summary ? { summary } : {}),
        });
      }
    }
  }

  private handleResultMessage(
    context: ClaudeCodeSessionContext,
    _activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    msg: Record<string, unknown>,
  ): void {
    if (context.activeTurn?.turnId !== turnId) return;

    const subtype = asString(msg.subtype) ?? "success";
    const isError = msg.is_error === true;

    // Update the Claude session ID if provided
    const resultSessionId = asString(msg.session_id);
    if (resultSessionId) {
      context.claudeSessionId = resultSessionId;
      updateSession(context, {
        resumeCursor: { claudeSessionId: resultSessionId },
      });
    }

    if (isError || subtype.startsWith("error")) {
      const resultText = asString(msg.result);
      const errorMsg = resultText || `Turn ended with error: ${subtype}`;
      this.handleTurnFailed(context, turnId, errorMsg);
    } else {
      this.finishTurn(context, turnId, {
        status: "completed",
        stopReason: "end_turn",
      });
    }
  }

  private handleControlRequest(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    msg: Record<string, unknown>,
  ): void {
    const claudeRequestId = asString(msg.request_id);
    if (!claudeRequestId) return;

    const request = asObject(msg.request);
    if (!request) return;

    const subtype = asString(request.subtype);

    // Acknowledge initialize response
    if (subtype === "initialize") {
      // Already handled as control_response in the line handler; ignore here
      return;
    }

    if (subtype !== "can_use_tool") {
      // Unknown control request — respond with error to unblock the CLI
      try {
        activeTurn.child.stdin.write(
          `${JSON.stringify({ type: "control_response", request_id: claudeRequestId, response: { subtype: "error", error: { message: `Unsupported control request: ${subtype}` } } })}\n`,
        );
      } catch {
        // ignore
      }
      return;
    }

    const toolName = asString(request.tool_name) ?? "unknown";
    const toolInput = request.input;
    const requestKind = requestKindFromToolName(toolName);

    // Find associated tool item if already tracked
    const existingItem = Array.from(activeTurn.toolItems.values()).find(
      (item) => item.toolName === toolName && !item.input,
    );
    const itemId = existingItem?.itemId ?? ProviderItemId.makeUnsafe(randomUUID());

    if (!existingItem) {
      const toolCtx: ClaudeCodeToolItemContext = {
        itemId,
        toolUseId: claudeRequestId,
        toolName,
        itemType: itemTypeFromToolName(toolName),
        input: toolInput,
      };
      activeTurn.toolItems.set(claudeRequestId, toolCtx);
    }

    const requestId = ApprovalRequestId.makeUnsafe(randomUUID());
    const pendingRequest: PendingApprovalRequest = {
      requestId,
      claudeRequestId,
      requestKind,
      toolName,
      input: toolInput,
      threadId: context.session.threadId,
      turnId,
      itemId,
    };

    activeTurn.pendingApprovals.set(requestId, pendingRequest);

    const detail = detailFromToolInput(toolName, toolInput);
    const path = pathFromToolInput(toolName, toolInput);

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "request",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method:
        requestKind === "command"
          ? "item/commandExecution/requestApproval"
          : requestKind === "file-change"
            ? "item/fileChange/requestApproval"
            : "item/fileRead/requestApproval",
      turnId,
      itemId,
      requestId,
      requestKind,
      payload: {
        toolName,
        toolInput,
        title: toolName,
        command: detail,
        ...(path ? { path } : {}),
      },
    });
  }

  private ensureItemStarted(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    itemId: ProviderItemId,
    itemType: string,
    payloadItem: Record<string, unknown>,
  ): void {
    if (activeTurn.startedItemIds.has(itemId)) return;
    activeTurn.startedItemIds.add(itemId);

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/started",
      turnId,
      itemId,
      payload: {
        item: { id: itemId, type: itemType, ...payloadItem },
      },
    });
  }

  private emitMessageSnapshotText(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    kind: "assistant" | "reasoning",
    snapshotText: string,
  ): void {
    const priorText =
      kind === "assistant" ? activeTurn.assistantMessageText : activeTurn.reasoningMessageText;
    const delta = snapshotText.startsWith(priorText)
      ? snapshotText.slice(priorText.length)
      : snapshotText;
    if (!delta) {
      return;
    }

    if (kind === "assistant") {
      activeTurn.assistantMessageText = snapshotText;
      this.emitTextDelta(
        context,
        activeTurn,
        turnId,
        activeTurn.assistantItemId,
        "agentMessage",
        "item/agentMessage/delta",
        delta,
      );
      return;
    }

    activeTurn.reasoningMessageText = snapshotText;
    this.emitTextDelta(
      context,
      activeTurn,
      turnId,
      activeTurn.reasoningItemId,
      "reasoning",
      "item/reasoning/textDelta",
      delta,
    );
  }

  private emitTextDelta(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    itemId: ProviderItemId,
    itemType: "agentMessage" | "reasoning",
    method: "item/agentMessage/delta" | "item/reasoning/textDelta",
    textDelta: string,
  ): void {
    this.ensureItemStarted(context, activeTurn, turnId, itemId, itemType, {});
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      turnId,
      itemId,
      textDelta,
      payload: {
        item: { id: itemId, type: itemType },
        delta: textDelta,
      },
    });
  }

  private emitItemCompleted(
    context: ClaudeCodeSessionContext,
    activeTurn: ClaudeCodeActiveTurnContext,
    turnId: TurnId,
    item: {
      id: ProviderItemId;
      type: string;
      status: string;
      summary?: string;
      title?: string;
    },
  ): void {
    if (!activeTurn.startedItemIds.has(item.id)) return;

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "item/completed",
      turnId,
      itemId: item.id,
      payload: {
        item: {
          id: item.id,
          type: item.type,
          status: item.status,
          ...(item.summary ? { summary: item.summary } : {}),
          ...(item.title ? { title: item.title } : {}),
        },
      },
    });
  }

  private handleTurnFailed(
    context: ClaudeCodeSessionContext,
    turnId: TurnId,
    errorMessage: string,
  ): void {
    if (context.activeTurn?.turnId !== turnId) return;

    this.emitErrorEvent(context, "turn/failed", errorMessage, turnId);
    this.finishTurn(context, turnId, {
      status: "failed",
      stopReason: "error",
      errorMessage,
    });
  }

  private finishTurn(
    context: ClaudeCodeSessionContext,
    turnId: TurnId,
    input: {
      status: "completed" | "failed" | "cancelled";
      stopReason: string;
      errorMessage?: string;
    },
  ): void {
    const activeTurn = context.activeTurn;
    if (!activeTurn || activeTurn.turnId !== turnId) return;

    // Complete any lingering started items
    for (const itemId of activeTurn.startedItemIds) {
      const toolCtx = Array.from(activeTurn.toolItems.values()).find((t) => t.itemId === itemId);
      const type = toolCtx?.itemType ?? "agentMessage";
      this.emitEvent({
        id: EventId.makeUnsafe(randomUUID()),
        kind: "notification",
        provider: "claude-code",
        threadId: context.session.threadId,
        createdAt: new Date().toISOString(),
        method: "item/completed",
        turnId,
        itemId: itemId as ProviderItemId,
        payload: {
          item: { id: itemId, type, status: input.status },
        },
      });
    }

    updateSession(context, {
      status: input.status === "failed" ? "error" : "ready",
      activeTurnId: undefined,
      ...(input.errorMessage ? { lastError: input.errorMessage } : {}),
    });

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "turn/completed",
      turnId,
      payload: {
        turn: {
          id: turnId,
          status: input.status,
          stopReason: input.stopReason,
          ...(input.errorMessage ? { error: { message: input.errorMessage } } : {}),
        },
      },
    });

    delete context.activeTurn;
  }

  private emitLifecycleEvent(
    context: ClaudeCodeSessionContext,
    method: string,
    message: string,
  ): void {
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "session",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      message,
    });
  }

  private emitErrorEvent(
    context: ClaudeCodeSessionContext,
    method: string,
    message: string,
    turnId?: TurnId,
  ): void {
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "error",
      provider: "claude-code",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method,
      message,
      ...(turnId ? { turnId } : {}),
    });
  }

  private emitEvent(event: ProviderEvent): void {
    this.emit("event", event);
  }
}
