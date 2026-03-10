import { DEFAULT_MODEL_BY_PROVIDER, type ProjectId, type ThreadId } from "@agents/contracts";
import type { DraftThreadState } from "./composerDraftStore";
import type { Project, Thread } from "./types";

export function sortThreadsNewestFirst(a: Thread, b: Thread): number {
  const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (byDate !== 0) return byDate;
  return b.id.localeCompare(a.id);
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModel: string,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    model: fallbackModel,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function buildProjectThreadList(input: {
  project: Project;
  threads: readonly Thread[];
  projectDraftThread: {
    threadId: ThreadId;
    draftThread: DraftThreadState;
  } | null;
}): Thread[] {
  const projectThreads = input.threads.filter((thread) => thread.projectId === input.project.id);
  if (!input.projectDraftThread) {
    return projectThreads.toSorted(sortThreadsNewestFirst);
  }

  const { threadId, draftThread } = input.projectDraftThread;
  if (draftThread.projectId !== input.project.id) {
    return projectThreads.toSorted(sortThreadsNewestFirst);
  }
  if (projectThreads.some((thread) => thread.id === threadId)) {
    return projectThreads.toSorted(sortThreadsNewestFirst);
  }

  return [
    ...projectThreads,
    buildLocalDraftThread(
      threadId,
      draftThread,
      input.project.model || DEFAULT_MODEL_BY_PROVIDER.codex,
      null,
    ),
  ].toSorted(sortThreadsNewestFirst);
}

export function buildProjectDraftThreadMap(input: {
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  projectDraftThreadIdByProjectId: Record<ProjectId, ThreadId>;
}): Map<ProjectId, { threadId: ThreadId; draftThread: DraftThreadState }> {
  const projectDraftThreads = new Map<
    ProjectId,
    { threadId: ThreadId; draftThread: DraftThreadState }
  >();
  for (const [projectId, threadId] of Object.entries(input.projectDraftThreadIdByProjectId) as [
    ProjectId,
    ThreadId,
  ][]) {
    const draftThread = input.draftThreadsByThreadId[threadId];
    if (!draftThread || draftThread.projectId !== projectId) {
      continue;
    }
    projectDraftThreads.set(projectId, { threadId, draftThread });
  }
  return projectDraftThreads;
}
