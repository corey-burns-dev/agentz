import type { ProjectId } from "@agents/contracts";

import type { Thread } from "./types";

export type ProjectThreadArchiveActionId =
	| "archive-all"
	| "keep-3"
	| "keep-5"
	| "keep-8";

export interface ProjectThreadArchiveAction {
	id: ProjectThreadArchiveActionId;
	keepCount: number | null;
	label: string;
}

export const PROJECT_THREAD_ARCHIVE_ACTIONS: ReadonlyArray<ProjectThreadArchiveAction> =
	[
		{
			id: "archive-all",
			keepCount: null,
			label: "Archive all threads",
		},
		{
			id: "keep-3",
			keepCount: 3,
			label: "Keep 3 latest threads",
		},
		{
			id: "keep-5",
			keepCount: 5,
			label: "Keep 5 latest threads",
		},
		{
			id: "keep-8",
			keepCount: 8,
			label: "Keep 8 latest threads",
		},
	] as const;

export function isProjectThreadArchiveActionId(
	value: string | null | undefined,
): value is ProjectThreadArchiveActionId {
	return PROJECT_THREAD_ARCHIVE_ACTIONS.some((action) => action.id === value);
}

export function getProjectThreadArchiveAction(
	actionId: ProjectThreadArchiveActionId,
): ProjectThreadArchiveAction {
	const action = PROJECT_THREAD_ARCHIVE_ACTIONS.find(
		(entry) => entry.id === actionId,
	);
	if (!action) {
		throw new Error(`Unknown project thread archive action: ${actionId}`);
	}
	return action;
}

export function sortProjectThreadsNewestFirst(
	threads: readonly Thread[],
	projectId: ProjectId,
): Thread[] {
	return threads
		.filter((thread) => thread.projectId === projectId)
		.toSorted((left, right) => {
			const byDate =
				new Date(right.createdAt).getTime() -
				new Date(left.createdAt).getTime();
			if (byDate !== 0) return byDate;
			return right.id.localeCompare(left.id);
		});
}

export function resolveProjectThreadsToArchive(
	actionId: ProjectThreadArchiveActionId,
	projectThreads: readonly Thread[],
): {
	keepCount: number | null;
	threadsToArchive: Thread[];
} {
	const action = getProjectThreadArchiveAction(actionId);
	if (action.keepCount === null) {
		return {
			keepCount: null,
			threadsToArchive: [...projectThreads],
		};
	}

	return {
		keepCount: action.keepCount,
		threadsToArchive: projectThreads.slice(action.keepCount),
	};
}
