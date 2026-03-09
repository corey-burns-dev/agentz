import { randomUUID } from "node:crypto";

import {
	type ProviderEvent,
	ProviderItemId,
	ThreadId,
	TurnId,
} from "@agents/contracts";
import { describe, expect, it } from "vitest";

import { ClaudeCodeAppServerManager } from "./claudeCodeAppServerManager.ts";
import type {
	ClaudeCodeActiveTurnContext,
	ClaudeCodeSessionContext,
} from "./claudeCodeAppServerSession.ts";

function createHarness() {
	const manager = new ClaudeCodeAppServerManager();
	const threadId = ThreadId.makeUnsafe("thread-claude-test");
	const turnId = TurnId.makeUnsafe("turn-claude-test");
	const createdAt = "2026-03-09T12:00:00.000Z";
	const events: ProviderEvent[] = [];

	manager.on("event", (event) => {
		events.push(event);
	});

	const activeTurn: ClaudeCodeActiveTurnContext = {
		turnId,
		child: {
			stdin: { write: () => true, end: () => undefined },
			stderr: { on: () => undefined },
			on: () => undefined,
		} as never,
		output: {
			on: () => undefined,
			close: () => undefined,
		} as never,
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

	const context: ClaudeCodeSessionContext = {
		session: {
			provider: "claude-code",
			status: "running",
			runtimeMode: "approval-required",
			threadId,
			cwd: "/tmp",
			activeTurnId: turnId,
			createdAt,
			updatedAt: createdAt,
		},
		providerOptions: {},
		activeTurn,
		turns: [],
		stopping: false,
	};

	return {
		manager,
		context,
		activeTurn,
		turnId,
		events,
	};
}

function handleAssistantMessage(
	manager: ClaudeCodeAppServerManager,
	context: ClaudeCodeSessionContext,
	activeTurn: ClaudeCodeActiveTurnContext,
	turnId: TurnId,
	msg: Record<string, unknown>,
) {
	(
		manager as unknown as {
			handleAssistantMessage: (
				context: ClaudeCodeSessionContext,
				activeTurn: ClaudeCodeActiveTurnContext,
				turnId: TurnId,
				msg: Record<string, unknown>,
			) => void;
		}
	).handleAssistantMessage(context, activeTurn, turnId, msg);
}

function handleStreamEvent(
	manager: ClaudeCodeAppServerManager,
	context: ClaudeCodeSessionContext,
	activeTurn: ClaudeCodeActiveTurnContext,
	turnId: TurnId,
	msg: Record<string, unknown>,
) {
	(
		manager as unknown as {
			handleStreamEvent: (
				context: ClaudeCodeSessionContext,
				activeTurn: ClaudeCodeActiveTurnContext,
				turnId: TurnId,
				msg: Record<string, unknown>,
			) => void;
		}
	).handleStreamEvent(context, activeTurn, turnId, msg);
}

describe("ClaudeCodeAppServerManager", () => {
	it("emits assistant text from assistant messages when no stream deltas were sent", () => {
		const { manager, context, activeTurn, turnId, events } = createHarness();

		handleAssistantMessage(manager, context, activeTurn, turnId, {
			message: {
				content: [{ type: "text", text: "Final Claude answer" }],
			},
		});

		expect(events.map((event) => event.method)).toEqual([
			"item/started",
			"item/agentMessage/delta",
		]);
		expect(events[1]?.textDelta).toBe("Final Claude answer");
	});

	it("only emits the new suffix when assistant message snapshots grow", () => {
		const { manager, context, activeTurn, turnId, events } = createHarness();

		handleAssistantMessage(manager, context, activeTurn, turnId, {
			message: {
				content: [{ type: "text", text: "Hel" }],
			},
		});
		handleAssistantMessage(manager, context, activeTurn, turnId, {
			message: {
				content: [{ type: "text", text: "Hello" }],
			},
		});

		expect(
			events
				.filter((event) => event.method === "item/agentMessage/delta")
				.map((event) => event.textDelta),
		).toEqual(["Hel", "lo"]);
	});

	it("does not duplicate assistant text already emitted from stream events", () => {
		const { manager, context, activeTurn, turnId, events } = createHarness();

		handleStreamEvent(manager, context, activeTurn, turnId, {
			stream_event: {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text" },
			},
		});
		handleStreamEvent(manager, context, activeTurn, turnId, {
			stream_event: {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hello" },
			},
		});
		handleAssistantMessage(manager, context, activeTurn, turnId, {
			message: {
				content: [{ type: "text", text: "Hello" }],
			},
		});

		expect(
			events.filter((event) => event.method === "item/agentMessage/delta"),
		).toHaveLength(1);
		expect(
			events.find((event) => event.method === "item/agentMessage/delta"),
		).toMatchObject({
			textDelta: "Hello",
		});
	});
});
