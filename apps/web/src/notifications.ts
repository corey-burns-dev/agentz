import type {
	OrchestrationEvent,
	ProjectionThreadTurnStatus,
	ThreadId,
} from "@agents/contracts";

import { getAppSettingsSnapshot } from "./appSettings";
import { toastManager } from "./components/ui/toast";
import {
	getProjectNotificationSettingsForKey,
	type PerProjectNotificationSettings,
} from "./projectNotificationSettings";
import { useStore } from "./store";

type TurnStatus = ProjectionThreadTurnStatus | "unknown";

interface DomainEventContext {
	activeThreadId: ThreadId | null;
}

interface ThreadContext {
	threadId: ThreadId;
	threadTitle: string | null;
	projectName: string | null;
	projectKey: string | null;
	status: TurnStatus;
	completedAtIso: string | null;
}

function isBrowserEnvironment(): boolean {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

function readForegroundState(threadIsActive: boolean): {
	isWindowVisible: boolean;
	isWindowFocused: boolean;
	isForegroundForThread: boolean;
} {
	if (!isBrowserEnvironment()) {
		return {
			isWindowVisible: false,
			isWindowFocused: false,
			isForegroundForThread: false,
		};
	}

	const isWindowVisible = document.visibilityState === "visible";
	const isWindowFocused =
		typeof document.hasFocus === "function" && document.hasFocus();
	const isForegroundForThread =
		isWindowVisible && isWindowFocused && threadIsActive;

	return { isWindowVisible, isWindowFocused, isForegroundForThread };
}

function getThreadContextFromStore(
	threadId: ThreadId,
	rawStatus: string | null,
	completedAtIso: string | null,
): ThreadContext {
	const state = useStore.getState();
	const thread = state.threads.find((entry) => entry.id === threadId) ?? null;

	let status: TurnStatus = "unknown";
	if (
		rawStatus === "running" ||
		rawStatus === "completed" ||
		rawStatus === "interrupted" ||
		rawStatus === "error"
	) {
		status = rawStatus;
	}

	if (!thread) {
		return {
			threadId,
			threadTitle: null,
			projectName: null,
			status,
			projectKey: null,
			completedAtIso,
		};
	}

	const project =
		state.projects.find((entry) => entry.id === thread.projectId) ?? null;

	return {
		threadId,
		threadTitle: thread.title,
		projectName: project?.name ?? null,
		projectKey: project?.cwd ?? null,
		status,
		completedAtIso,
	};
}

function shouldNotifyForSuccess(
	_context: ThreadContext,
	perProject: PerProjectNotificationSettings,
): boolean {
	if (perProject.disabled) return false;
	if (perProject.notifyOnTurnComplete === false) return false;
	return true;
}

function shouldNotifyForError(
	_context: ThreadContext,
	perProject: PerProjectNotificationSettings,
): boolean {
	if (perProject.disabled) return false;
	if (perProject.notifyOnError === false) return false;
	return true;
}

function showTurnCompletedToast(context: ThreadContext): void {
	const parts: string[] = [];
	if (context.threadTitle) {
		parts.push(context.threadTitle);
	}
	if (context.projectName) {
		parts.push(context.projectName);
	}

	const description =
		parts.length > 0
			? parts.join(" \u00b7 ")
			: "Agent turn completed in background.";

	toastManager.add({
		type: "success",
		title: "Reply ready",
		description,
		data: {
			// Let this behave like a global toast; we intentionally do not
			// scope by threadId so users notice cross-thread completions.
			dismissAfterVisibleMs: 8_000,
		},
	});
}

function showErrorToast(context: ThreadContext, detail?: string): void {
	const parts: string[] = [];
	if (context.threadTitle) {
		parts.push(context.threadTitle);
	}
	if (context.projectName) {
		parts.push(context.projectName);
	}

	const descriptionBase =
		detail && detail.trim().length > 0
			? detail.trim()
			: "An error occurred while running this turn.";

	const prefix = parts.length > 0 ? `${parts.join(" \u00b7 ")} — ` : "";

	toastManager.add({
		type: "error",
		title: "Agent error",
		description: `${prefix}${descriptionBase}`,
		data: {
			dismissAfterVisibleMs: 10_000,
		},
	});
}

let notificationPermissionRequested = false;

async function ensureNotificationPermission(): Promise<boolean> {
	if (!isBrowserEnvironment() || !("Notification" in window)) {
		return false;
	}

	if (Notification.permission === "granted") {
		return true;
	}

	if (Notification.permission === "denied") {
		return false;
	}

	if (notificationPermissionRequested) {
		// Avoid spamming repeated prompts when the user ignores the first one.
		return false;
	}

	notificationPermissionRequested = true;
	try {
		const result = await Notification.requestPermission();
		return result === "granted";
	} catch {
		return false;
	}
}

/**
 * Build URL for a thread. TanStack Router uses pathless layout _chat, so the
 * actual path is /$threadId (e.g. /abc-123), not /_chat/abc-123.
 */
function buildThreadUrl(threadId: ThreadId): string {
	try {
		const current = new URL(window.location.href);
		current.pathname = `/${encodeURIComponent(String(threadId) as string)}`;
		current.search = "";
		return current.toString();
	} catch {
		return `/${encodeURIComponent(String(threadId) as string)}`;
	}
}

async function showOsNotification(
	context: ThreadContext,
	kind: "success" | "error",
): Promise<void> {
	if (!("Notification" in window)) return;

	const hasPermission = await ensureNotificationPermission();
	if (!hasPermission) return;

	const title =
		kind === "success"
			? context.projectName
				? `Reply ready in ${context.projectName}`
				: "Reply ready"
			: context.projectName
				? `Error in ${context.projectName}`
				: "Agent error";

	const lines: string[] = [];
	if (context.threadTitle) {
		lines.push(context.threadTitle);
	}
	if (kind === "success") {
		lines.push("Turn completed.");
	} else {
		lines.push("A turn failed. Open the thread for details.");
	}

	const body = lines.join("\n");

	const notification = new Notification(title, {
		body,
		tag: `thread:${String(context.threadId)}`,
	});

	notification.onclick = () => {
		try {
			window.focus();
		} catch {
			// Ignore focus errors; navigation still proceeds.
		}
		try {
			window.location.href = buildThreadUrl(context.threadId);
		} catch {
			// Ignore navigation errors.
		}
		notification.close();
	};
}

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
	if (!isBrowserEnvironment()) return null;
	try {
		if (!audioContext) {
			audioContext = new (
				window.AudioContext ||
				(window as unknown as { webkitAudioContext?: typeof AudioContext })
					.webkitAudioContext
			)();
		}
	} catch {
		audioContext = null;
	}
	return audioContext;
}

function playTone(kind: "success" | "error"): void {
	const ctx = getAudioContext();
	if (!ctx) return;

	try {
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();

		oscillator.type = "sine";
		oscillator.frequency.value = kind === "success" ? 880 : 440;

		const now = ctx.currentTime;
		const duration = 0.18;

		gain.gain.setValueAtTime(0.0, now);
		gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

		oscillator.connect(gain);
		gain.connect(ctx.destination);

		oscillator.start(now);
		oscillator.stop(now + duration + 0.02);
	} catch {
		// Swallow audio errors; sounds are best-effort only.
	}
}

function maybePlaySound(
	kind: "success" | "error",
	isWindowFocused: boolean,
	perProject: PerProjectNotificationSettings,
): void {
	if (perProject.disabled) return;

	const appSettings = getAppSettingsSnapshot();
	if (kind === "success") {
		if (!appSettings.playSoundOnAssistantReply) return;
	} else {
		if (!appSettings.playSoundOnError) return;
	}

	if (appSettings.muteWhileWindowFocused && isWindowFocused) {
		return;
	}

	playTone(kind);
}

/**
 * payload.status is OrchestrationCheckpointStatus: "ready" | "missing" | "error".
 * Only "ready" means a successful turn; "error" and "missing" should trigger
 * error notifications or silence, not success.
 */
function handleTurnDiffCompleted(
	event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
	context: DomainEventContext,
): void {
	if (!isBrowserEnvironment()) {
		return;
	}

	const payload = event.payload;
	const checkpointStatus = payload.status ?? "ready";
	const isSuccess = checkpointStatus === "ready";
	const isError = checkpointStatus === "error";

	const threadContext = getThreadContextFromStore(
		payload.threadId,
		isSuccess ? "completed" : isError ? "error" : "unknown",
		payload.completedAt,
	);

	const perProject = getProjectNotificationSettingsForKey(
		threadContext.projectKey,
	);

	const isActiveThread =
		context.activeThreadId !== null &&
		context.activeThreadId === threadContext.threadId;
	const { isWindowVisible, isWindowFocused, isForegroundForThread } =
		readForegroundState(isActiveThread);

	const appSettings = getAppSettingsSnapshot();

	if (isSuccess) {
		if (!shouldNotifyForSuccess(threadContext, perProject)) {
			return;
		}
		// Show an in-app toast when the turn completes in the background or in a
		// different thread, so the user can see cross-thread completions.
		if (!isForegroundForThread) {
			showTurnCompletedToast(threadContext);
		}
		const shouldShowOsNotification =
			appSettings.enableDesktopNotifications &&
			(!isWindowVisible || !isWindowFocused || !isActiveThread);
		if (shouldShowOsNotification) {
			void showOsNotification(threadContext, "success");
		}
		maybePlaySound("success", isWindowFocused, perProject);
		return;
	}

	if (isError) {
		if (!shouldNotifyForError(threadContext, perProject)) {
			return;
		}
		if (!isForegroundForThread) {
			showErrorToast(threadContext);
		}
		const shouldShowOsNotification =
			appSettings.enableDesktopNotifications &&
			(!isWindowVisible || !isWindowFocused || !isActiveThread);
		if (shouldShowOsNotification) {
			void showOsNotification(threadContext, "error");
		}
		maybePlaySound("error", isWindowFocused, perProject);
	}
	// "missing" or other: no notification
}

function handleActivityAppended(
	event: Extract<OrchestrationEvent, { type: "thread.activity-appended" }>,
	context: DomainEventContext,
): void {
	if (!isBrowserEnvironment()) {
		return;
	}

	const payload = event.payload;
	const activity = payload.activity;
	const tone = (activity.tone as string | undefined) ?? "";

	const isErrorTone =
		tone === "error" ||
		tone === "destructive" ||
		(activity.summary ?? "").toLowerCase().includes("error");

	if (!isErrorTone) {
		return;
	}

	const threadContext = getThreadContextFromStore(
		payload.threadId,
		"error",
		null,
	);
	const perProject = getProjectNotificationSettingsForKey(
		threadContext.projectKey,
	);
	if (!shouldNotifyForError(threadContext, perProject)) {
		return;
	}

	const isActiveThread =
		context.activeThreadId !== null &&
		context.activeThreadId === threadContext.threadId;
	const { isWindowVisible, isWindowFocused, isForegroundForThread } =
		readForegroundState(isActiveThread);

	// Always surface errors in-app, but avoid duplicating noise while the
	// user is already staring at the thread.
	if (!isForegroundForThread) {
		const detail =
			typeof activity.payload === "object" &&
			activity.payload &&
			"text" in (activity.payload as Record<string, unknown>) &&
			typeof (activity.payload as Record<string, unknown>).text === "string"
				? ((activity.payload as Record<string, unknown>).text as string)
				: undefined;
		showErrorToast(threadContext, detail);
	}

	const appSettings = getAppSettingsSnapshot();
	const shouldShowOsNotification =
		appSettings.enableDesktopNotifications &&
		(!isWindowVisible || !isWindowFocused || !isActiveThread);

	if (shouldShowOsNotification) {
		void showOsNotification(threadContext, "error");
	}

	maybePlaySound("error", isWindowFocused, perProject);
}

export function handleOrchestrationEventForNotifications(
	event: OrchestrationEvent,
	context: DomainEventContext,
): void {
	if (event.aggregateKind !== "thread") {
		return;
	}

	switch (event.type) {
		case "thread.turn-diff-completed":
			handleTurnDiffCompleted(event, context);
			return;
		case "thread.activity-appended":
			handleActivityAppended(event, context);
			return;
		default:
			return;
	}
}
