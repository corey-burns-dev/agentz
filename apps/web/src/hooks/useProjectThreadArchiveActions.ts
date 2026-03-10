import { ThreadId } from "@agents/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
	type ProjectThreadArchiveActionId,
	resolveProjectThreadsToArchive,
	sortProjectThreadsNewestFirst,
} from "../projectThreadArchiveActions";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import type { Project, Thread } from "../types";

export function useProjectThreadArchiveActions() {
	const threads = useStore((store) => store.threads);
	const clearComposerDraftForThread = useComposerDraftStore(
		(store) => store.clearThreadDraft,
	);
	const clearProjectDraftThreadById = useComposerDraftStore(
		(store) => store.clearProjectDraftThreadById,
	);
	const clearTerminalState = useTerminalStateStore(
		(state) => state.clearTerminalState,
	);
	const navigate = useNavigate();
	const routeThreadId = useParams({
		strict: false,
		select: (params) =>
			params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
	});

	const bulkDeleteThreads = useCallback(
		async (threadsToDelete: readonly Thread[]) => {
			const api = readNativeApi();
			if (!api || threadsToDelete.length === 0) return;

			const deletedIds = new Set(threadsToDelete.map((thread) => thread.id));
			const shouldNavigate =
				routeThreadId !== null && deletedIds.has(routeThreadId);
			const fallbackThread = shouldNavigate
				? (threads.find((thread) => !deletedIds.has(thread.id)) ?? null)
				: null;

			for (const thread of threadsToDelete) {
				if (thread.session && thread.session.status !== "closed") {
					await api.orchestration
						.dispatchCommand({
							type: "thread.session.stop",
							commandId: newCommandId(),
							threadId: thread.id,
							createdAt: new Date().toISOString(),
						})
						.catch(() => undefined);
				}
				try {
					await api.terminal.close({
						threadId: thread.id,
						deleteHistory: true,
					});
				} catch {
					// Terminal may already be closed.
				}
				await api.orchestration.dispatchCommand({
					type: "thread.delete",
					commandId: newCommandId(),
					threadId: thread.id,
				});
				clearComposerDraftForThread(thread.id);
				clearProjectDraftThreadById(thread.projectId, thread.id);
				clearTerminalState(thread.id);
			}

			if (shouldNavigate) {
				if (fallbackThread) {
					void navigate({
						to: "/$threadId",
						params: { threadId: fallbackThread.id },
						replace: true,
					});
				} else {
					void navigate({ to: "/", replace: true });
				}
			}
		},
		[
			clearComposerDraftForThread,
			clearProjectDraftThreadById,
			clearTerminalState,
			navigate,
			routeThreadId,
			threads,
		],
	);

	const runProjectThreadArchiveAction = useCallback(
		async (
			project: Pick<Project, "id" | "name">,
			actionId: ProjectThreadArchiveActionId,
		) => {
			const api = readNativeApi();
			if (!api) return;

			const projectThreads = sortProjectThreadsNewestFirst(threads, project.id);
			const { keepCount, threadsToArchive } = resolveProjectThreadsToArchive(
				actionId,
				projectThreads,
			);

			if (actionId === "archive-all") {
				if (threadsToArchive.length === 0) {
					toastManager.add({ type: "info", title: "No threads to archive" });
					return;
				}
				const confirmed = await api.dialogs.confirm(
					`Delete all ${threadsToArchive.length} thread${threadsToArchive.length === 1 ? "" : "s"} in "${project.name}"?\nThis permanently clears conversation history.`,
				);
				if (!confirmed) return;
				await bulkDeleteThreads(threadsToArchive);
				toastManager.add({
					type: "success",
					title: `Archived ${threadsToArchive.length} thread${threadsToArchive.length === 1 ? "" : "s"}`,
				});
				return;
			}

			if (keepCount === null) {
				return;
			}
			if (threadsToArchive.length === 0) {
				toastManager.add({
					type: "info",
					title: `Already at or below ${keepCount} threads`,
				});
				return;
			}

			const confirmed = await api.dialogs.confirm(
				`Delete ${threadsToArchive.length} older thread${threadsToArchive.length === 1 ? "" : "s"} from "${project.name}"?\nThe ${keepCount} most recent threads will be kept.`,
			);
			if (!confirmed) return;
			await bulkDeleteThreads(threadsToArchive);
			toastManager.add({
				type: "success",
				title: `Kept ${Math.min(projectThreads.length, keepCount)}, deleted ${threadsToArchive.length} thread${threadsToArchive.length === 1 ? "" : "s"}`,
			});
		},
		[bulkDeleteThreads, threads],
	);

	return {
		runProjectThreadArchiveAction,
	};
}
