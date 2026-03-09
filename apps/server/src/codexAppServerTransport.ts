import type { JsonRpcRequest } from "./codexAppServerEventRouter";
import { classifyCodexStderrLine } from "./codexAppServerHelpers";
import type { CodexSessionContext } from "./codexAppServerSession";

export interface JsonRpcError {
	code?: number;
	message?: string;
}

export interface JsonRpcResponse {
	id: string | number;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcNotification {
	method: string;
	params?: unknown;
}

export interface CodexTransportListeners {
	onStdoutLine: (line: string) => void;
	onStderrMessage: (message: string) => void;
	onProcessError: (error: Error) => void;
	onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface CodexProtocolLineHandlers {
	onRequest: (request: JsonRpcRequest) => void;
	onNotification: (notification: JsonRpcNotification) => void;
	onResponse: (response: JsonRpcResponse) => void;
	onProtocolError: (method: string, message: string) => void;
}

export function attachCodexTransportListeners(
	context: CodexSessionContext,
	listeners: CodexTransportListeners,
): void {
	context.output.on("line", (line) => {
		listeners.onStdoutLine(line);
	});

	context.child.stderr.on("data", (chunk: Buffer) => {
		const raw = chunk.toString();
		const lines = raw.split(/\r?\n/g);
		for (const rawLine of lines) {
			const classified = classifyCodexStderrLine(rawLine);
			if (!classified) {
				continue;
			}

			listeners.onStderrMessage(classified.message);
		}
	});

	context.child.on("error", (error) => {
		listeners.onProcessError(error);
	});

	context.child.on("exit", (code, signal) => {
		listeners.onExit(code, signal);
	});
}

export function routeCodexProtocolLine(
	line: string,
	handlers: CodexProtocolLineHandlers,
): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		handlers.onProtocolError(
			"protocol/parseError",
			"Received invalid JSON from codex app-server.",
		);
		return;
	}

	if (!parsed || typeof parsed !== "object") {
		handlers.onProtocolError(
			"protocol/invalidMessage",
			"Received non-object protocol message.",
		);
		return;
	}

	if (isServerRequest(parsed)) {
		handlers.onRequest(parsed);
		return;
	}

	if (isServerNotification(parsed)) {
		handlers.onNotification(parsed);
		return;
	}

	if (isResponse(parsed)) {
		handlers.onResponse(parsed);
		return;
	}

	handlers.onProtocolError(
		"protocol/unrecognizedMessage",
		"Received protocol message in an unknown shape.",
	);
}

export async function sendJsonRpcRequest<TResponse>(
	context: CodexSessionContext,
	method: string,
	params: unknown,
	timeoutMs = 20_000,
): Promise<TResponse> {
	const id = context.nextRequestId;
	context.nextRequestId += 1;

	const result = await new Promise<unknown>((resolve, reject) => {
		const timeout = setTimeout(() => {
			context.pending.delete(String(id));
			reject(new Error(`Timed out waiting for ${method}.`));
		}, timeoutMs);

		context.pending.set(String(id), {
			method,
			timeout,
			resolve,
			reject,
		});
		writeJsonRpcMessage(context, {
			method,
			id,
			params,
		});
	});

	return result as TResponse;
}

export function writeJsonRpcMessage(
	context: CodexSessionContext,
	message: unknown,
): void {
	const encoded = JSON.stringify(message);
	if (!context.child.stdin.writable) {
		throw new Error("Cannot write to codex app-server stdin.");
	}

	context.child.stdin.write(`${encoded}\n`);
}

export function isServerRequest(value: unknown): value is JsonRpcRequest {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.method === "string" &&
		(typeof candidate.id === "string" || typeof candidate.id === "number")
	);
}

export function isServerNotification(
	value: unknown,
): value is JsonRpcNotification {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.method === "string" && !("id" in candidate);
}

export function isResponse(value: unknown): value is JsonRpcResponse {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	const hasId =
		typeof candidate.id === "string" || typeof candidate.id === "number";
	const hasMethod = typeof candidate.method === "string";
	return hasId && !hasMethod;
}
