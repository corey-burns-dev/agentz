import {
	type ChildProcessWithoutNullStreams,
	spawnSync,
} from "node:child_process";
import type { Interface as ReadlineInterface } from "node:readline";

import {
	type ApprovalRequestId,
	ProviderItemId,
	type ProviderRequestKind,
	type ProviderSession,
	type ProviderSessionStartInput,
	type RuntimeMode,
	type ThreadId,
	TurnId,
} from "@agents/contracts";

import {
	formatClaudeCodeCliUpgradeMessage,
	isClaudeCodeCliVersionSupported,
	parseClaudeCodeCliVersion,
} from "./provider/claudeCodeCliVersion";

// ── Pending request types ──────────────────────────────────────────────

export interface PendingApprovalRequest {
	requestId: ApprovalRequestId;
	/** The claude CLI's control request_id used for writing control_response to stdin */
	claudeRequestId: string;
	requestKind: ProviderRequestKind;
	toolName: string;
	input: unknown;
	threadId: ThreadId;
	turnId?: TurnId;
	itemId?: ProviderItemId;
}

// ── Content block tracking ─────────────────────────────────────────────

export interface ContentBlockContext {
	index: number;
	type: "text" | "thinking" | "tool_use";
	itemId: ProviderItemId;
	toolUseId?: string;
	toolName?: string;
}

// ── Tool item tracking ─────────────────────────────────────────────────

export interface ClaudeCodeToolItemContext {
	itemId: ProviderItemId;
	toolUseId: string;
	toolName: string;
	itemType: string;
	input?: unknown;
}

// ── Active turn context ────────────────────────────────────────────────

export interface ClaudeCodeActiveTurnContext {
	turnId: TurnId;
	child: ChildProcessWithoutNullStreams;
	output: ReadlineInterface;
	assistantItemId: ProviderItemId;
	reasoningItemId: ProviderItemId;
	assistantTextStreamed: boolean;
	reasoningTextStreamed: boolean;
	assistantMessageText: string;
	reasoningMessageText: string;
	/** Content blocks currently being streamed, keyed by block index */
	contentBlocks: Map<number, ContentBlockContext>;
	/** Tool items keyed by tool_use_id */
	toolItems: Map<string, ClaudeCodeToolItemContext>;
	startedItemIds: Set<string>;
	pendingApprovals: Map<ApprovalRequestId, PendingApprovalRequest>;
	/** Whether the control protocol initialize has been sent */
	controlInitialized: boolean;
}

// ── Turn snapshot ──────────────────────────────────────────────────────

export interface ClaudeCodeTurnSnapshot {
	id: TurnId;
	items: unknown[];
}

export interface ClaudeCodeResolvedProviderOptions {
	readonly binaryPath?: string;
	readonly homePath?: string;
}

// ── Session context ────────────────────────────────────────────────────

export interface ClaudeCodeSessionContext {
	session: ProviderSession;
	providerOptions: ClaudeCodeResolvedProviderOptions;
	/** The Claude CLI session ID from the system/init message. Used for --resume. */
	claudeSessionId?: string;
	activeTurn?: ClaudeCodeActiveTurnContext;
	turns: ClaudeCodeTurnSnapshot[];
	stopping: boolean;
}

// ── Input types ────────────────────────────────────────────────────────

export interface ClaudeCodeAppServerStartSessionInput {
	readonly threadId: ThreadId;
	readonly provider?: "claude-code";
	readonly cwd?: string;
	readonly model?: string;
	readonly resumeCursor?: unknown;
	readonly providerOptions?: ProviderSessionStartInput["providerOptions"];
	readonly runtimeMode: RuntimeMode;
}

export interface ClaudeCodeAppServerSendTurnInput {
	readonly threadId: ThreadId;
	readonly input?: string;
	readonly attachments?: ReadonlyArray<{ type: "image"; url: string }>;
	readonly model?: string;
	readonly interactionMode?: "default" | "plan";
}

// ── Thread snapshot ────────────────────────────────────────────────────

export interface ClaudeCodeThreadSnapshot {
	threadId: string;
	turns: ClaudeCodeTurnSnapshot[];
}

// ── Session state helpers ──────────────────────────────────────────────

export function updateSession(
	context: ClaudeCodeSessionContext,
	updates: Partial<ProviderSession>,
): void {
	context.session = {
		...context.session,
		...updates,
		updatedAt: new Date().toISOString(),
	};
}

// ── Provider options ───────────────────────────────────────────────────

export function readClaudeCodeProviderOptions(
	input: ClaudeCodeAppServerStartSessionInput,
): ClaudeCodeResolvedProviderOptions {
	const options = input.providerOptions?.claudeCode;
	if (!options) {
		return {};
	}
	return {
		...(options.binaryPath ? { binaryPath: options.binaryPath } : {}),
		...(options.homePath ? { homePath: options.homePath } : {}),
	};
}

// ── Resume cursor ──────────────────────────────────────────────────────

export function readResumeClaudeSessionId(
	input: Pick<ClaudeCodeAppServerStartSessionInput, "resumeCursor">,
): string | undefined {
	const resumeCursor = input.resumeCursor;
	if (
		!resumeCursor ||
		typeof resumeCursor !== "object" ||
		Array.isArray(resumeCursor)
	) {
		return undefined;
	}
	const raw = (resumeCursor as Record<string, unknown>).claudeSessionId;
	return typeof raw === "string" && raw.trim().length > 0
		? raw.trim()
		: undefined;
}

// ── Version check ──────────────────────────────────────────────────────

const CLAUDE_CODE_VERSION_CHECK_TIMEOUT_MS = 5_000;

export function assertSupportedClaudeCodeCliVersion(input: {
	readonly binaryPath: string;
	readonly cwd: string;
	readonly homePath?: string;
}): void {
	const result = spawnSync(input.binaryPath, ["--version"], {
		cwd: input.cwd,
		env: buildClaudeCodeEnvironment(process.env, input.homePath),
		encoding: "utf8",
		shell: process.platform === "win32",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: CLAUDE_CODE_VERSION_CHECK_TIMEOUT_MS,
		maxBuffer: 1024 * 1024,
	});

	if (result.error) {
		const lower = result.error.message.toLowerCase();
		if (
			lower.includes("enoent") ||
			lower.includes("command not found") ||
			lower.includes("not found")
		) {
			throw new Error(
				`Claude Code CLI (${input.binaryPath}) is not installed or not executable. Install with: npm install -g @anthropic-ai/claude-code`,
			);
		}
		throw new Error(
			`Failed to execute Claude Code CLI version check: ${result.error.message}`,
		);
	}

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	if (result.status !== 0) {
		const detail =
			stderr.trim() ||
			stdout.trim() ||
			`Command exited with code ${result.status}.`;
		throw new Error(`Claude Code CLI version check failed. ${detail}`);
	}

	const combined = `${stdout}\n${stderr}`;
	const parsedVersion = parseClaudeCodeCliVersion(combined);
	if (parsedVersion && !isClaudeCodeCliVersionSupported(parsedVersion)) {
		throw new Error(formatClaudeCodeCliUpgradeMessage(parsedVersion));
	}
}

export function buildClaudeCodeEnvironment(
	baseEnvironment: NodeJS.ProcessEnv,
	homePath?: string,
): NodeJS.ProcessEnv {
	return {
		...baseEnvironment,
		...(homePath ? { CLAUDE_CONFIG_DIR: homePath } : {}),
	};
}

// ── ID helpers ─────────────────────────────────────────────────────────

export function toTurnId(value: string | undefined): TurnId | undefined {
	const normalized = value?.trim();
	return normalized?.length ? TurnId.makeUnsafe(normalized) : undefined;
}

export function toProviderItemId(
	value: string | undefined,
): ProviderItemId | undefined {
	const normalized = value?.trim();
	return normalized?.length ? ProviderItemId.makeUnsafe(normalized) : undefined;
}
