import {
	type ChildProcessWithoutNullStreams,
	spawnSync,
} from "node:child_process";
import type { Interface as ReadlineInterface } from "node:readline";

import {
	type ApprovalRequestId,
	type ProviderInteractionMode,
	ProviderItemId,
	type ProviderRequestKind,
	type ProviderSession,
	type ProviderSessionStartInput,
	type RuntimeMode,
	type ThreadId,
	TurnId,
} from "@agentz/contracts";
import type { CodexAccountSnapshot } from "./codexAppServerHelpers";

import {
	formatCodexCliUpgradeMessage,
	isCodexCliVersionSupported,
	parseCodexCliVersion,
} from "./provider/codexCliVersion";

export type PendingRequestKey = string;

export interface PendingRequest {
	method: string;
	timeout: ReturnType<typeof setTimeout>;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

export interface PendingApprovalRequest {
	requestId: ApprovalRequestId;
	jsonRpcId: string | number;
	method:
		| "item/commandExecution/requestApproval"
		| "item/fileChange/requestApproval"
		| "item/fileRead/requestApproval";
	requestKind: ProviderRequestKind;
	threadId: ThreadId;
	turnId?: TurnId;
	itemId?: ProviderItemId;
}

export interface PendingUserInputRequest {
	requestId: ApprovalRequestId;
	jsonRpcId: string | number;
	threadId: ThreadId;
	turnId?: TurnId;
	itemId?: ProviderItemId;
}

export interface CodexSessionContext {
	session: ProviderSession;
	account: CodexAccountSnapshot;
	child: ChildProcessWithoutNullStreams;
	output: ReadlineInterface;
	pending: Map<PendingRequestKey, PendingRequest>;
	pendingApprovals: Map<ApprovalRequestId, PendingApprovalRequest>;
	pendingUserInputs: Map<ApprovalRequestId, PendingUserInputRequest>;
	nextRequestId: number;
	stopping: boolean;
}

export type { CodexAccountSnapshot } from "./codexAppServerHelpers";

export interface CodexAppServerSendTurnInput {
	readonly threadId: ThreadId;
	readonly input?: string;
	readonly attachments?: ReadonlyArray<{ type: "image"; url: string }>;
	readonly model?: string;
	readonly serviceTier?: string | null;
	readonly effort?: string;
	readonly interactionMode?: ProviderInteractionMode;
}

export interface CodexAppServerStartSessionInput {
	readonly threadId: ThreadId;
	readonly provider?: "codex";
	readonly cwd?: string;
	readonly model?: string;
	readonly serviceTier?: string;
	readonly resumeCursor?: unknown;
	readonly providerOptions?: ProviderSessionStartInput["providerOptions"];
	readonly runtimeMode: RuntimeMode;
}

export interface CodexThreadTurnSnapshot {
	id: TurnId;
	items: unknown[];
}

export interface CodexThreadSnapshot {
	threadId: string;
	turns: CodexThreadTurnSnapshot[];
}

const CODEX_VERSION_CHECK_TIMEOUT_MS = 5_000;

export function updateSession(
	context: CodexSessionContext,
	updates: Partial<ProviderSession>,
): void {
	context.session = {
		...context.session,
		...updates,
		updatedAt: new Date().toISOString(),
	};
}

export function requestKindForMethod(
	method: string,
): ProviderRequestKind | undefined {
	if (method === "item/commandExecution/requestApproval") {
		return "command";
	}

	if (method === "item/fileRead/requestApproval") {
		return "file-read";
	}

	if (method === "item/fileChange/requestApproval") {
		return "file-change";
	}

	return undefined;
}

export function parseThreadSnapshot(
	method: string,
	response: unknown,
): CodexThreadSnapshot {
	const responseRecord = readObject(response);
	const thread = readObject(responseRecord, "thread");
	const threadIdRaw =
		readString(thread, "id") ?? readString(responseRecord, "threadId");
	if (!threadIdRaw) {
		throw new Error(`${method} response did not include a thread id.`);
	}

	const turnsRaw =
		readArray(thread, "turns") ?? readArray(responseRecord, "turns") ?? [];
	const turns = turnsRaw.map((turnValue, index) => {
		const turn = readObject(turnValue);
		const turnIdRaw =
			readString(turn, "id") ?? `${threadIdRaw}:turn:${index + 1}`;
		const turnId = TurnId.makeUnsafe(turnIdRaw);
		const items = readArray(turn, "items") ?? [];
		return {
			id: turnId,
			items,
		};
	});

	return {
		threadId: threadIdRaw,
		turns,
	};
}

export function readRouteFields(params: unknown): {
	turnId?: TurnId;
	itemId?: ProviderItemId;
} {
	const route: {
		turnId?: TurnId;
		itemId?: ProviderItemId;
	} = {};

	const turnId = toTurnId(
		readString(params, "turnId") ??
			readString(readObject(params, "turn"), "id"),
	);
	const itemId = toProviderItemId(
		readString(params, "itemId") ??
			readString(readObject(params, "item"), "id"),
	);

	if (turnId) {
		route.turnId = turnId;
	}

	if (itemId) {
		route.itemId = itemId;
	}

	return route;
}

export function readObject(
	value: unknown,
	key?: string,
): Record<string, unknown> | undefined {
	const target =
		key === undefined
			? value
			: value && typeof value === "object"
				? (value as Record<string, unknown>)[key]
				: undefined;

	if (!target || typeof target !== "object") {
		return undefined;
	}

	return target as Record<string, unknown>;
}

export function readArray(value: unknown, key?: string): unknown[] | undefined {
	const target =
		key === undefined
			? value
			: value && typeof value === "object"
				? (value as Record<string, unknown>)[key]
				: undefined;
	return Array.isArray(target) ? target : undefined;
}

export function readString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "string" ? candidate : undefined;
}

export function readBoolean(value: unknown, key: string): boolean | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "boolean" ? candidate : undefined;
}

export function brandIfNonEmpty<T extends string>(
	value: string | undefined,
	maker: (value: string) => T,
): T | undefined {
	const normalized = value?.trim();
	return normalized?.length ? maker(normalized) : undefined;
}

export function normalizeProviderThreadId(
	value: string | undefined,
): string | undefined {
	return brandIfNonEmpty(value, (normalized) => normalized);
}

export function readCodexProviderOptions(
	input: CodexAppServerStartSessionInput,
): {
	readonly binaryPath?: string;
	readonly homePath?: string;
} {
	const options = input.providerOptions?.codex;
	if (!options) {
		return {};
	}
	return {
		...(options.binaryPath ? { binaryPath: options.binaryPath } : {}),
		...(options.homePath ? { homePath: options.homePath } : {}),
	};
}

export function assertSupportedCodexCliVersion(input: {
	readonly binaryPath: string;
	readonly cwd: string;
	readonly homePath?: string;
}): void {
	const result = spawnSync(input.binaryPath, ["--version"], {
		cwd: input.cwd,
		env: {
			...process.env,
			...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
		},
		encoding: "utf8",
		shell: process.platform === "win32",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: CODEX_VERSION_CHECK_TIMEOUT_MS,
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
				`Codex CLI (${input.binaryPath}) is not installed or not executable.`,
			);
		}
		throw new Error(
			`Failed to execute Codex CLI version check: ${result.error.message || String(result.error)}`,
		);
	}

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	if (result.status !== 0) {
		const detail =
			stderr.trim() ||
			stdout.trim() ||
			`Command exited with code ${result.status}.`;
		throw new Error(`Codex CLI version check failed. ${detail}`);
	}

	const parsedVersion = parseCodexCliVersion(`${stdout}\n${stderr}`);
	if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
		throw new Error(formatCodexCliUpgradeMessage(parsedVersion));
	}
}

export function readResumeCursorThreadId(
	resumeCursor: unknown,
): string | undefined {
	if (
		!resumeCursor ||
		typeof resumeCursor !== "object" ||
		Array.isArray(resumeCursor)
	) {
		return undefined;
	}
	const rawThreadId = (resumeCursor as Record<string, unknown>).threadId;
	return typeof rawThreadId === "string"
		? normalizeProviderThreadId(rawThreadId)
		: undefined;
}

export function readResumeThreadId(
	input: Pick<CodexAppServerStartSessionInput, "resumeCursor">,
): string | undefined {
	return readResumeCursorThreadId(input.resumeCursor);
}

export function toTurnId(value: string | undefined): TurnId | undefined {
	return brandIfNonEmpty(value, TurnId.makeUnsafe);
}

export function toProviderItemId(
	value: string | undefined,
): ProviderItemId | undefined {
	return brandIfNonEmpty(value, ProviderItemId.makeUnsafe);
}
