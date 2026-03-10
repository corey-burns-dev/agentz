import { ProjectId, ThreadId } from "@agents/contracts";
import { describe, expect, it } from "vitest";
import type { DraftThreadState } from "./composerDraftStore";
import { buildProjectDraftThreadMap, buildProjectThreadList } from "./threadDrafts";
import type { Project, Thread } from "./types";

function createProject(overrides?: Partial<Project>): Project {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Agents",
    cwd: "/tmp/agents",
    model: "gpt-5-codex",
    expanded: true,
    scripts: [],
    updatedAt: "2026-03-09T10:00:00.000Z",
    ...overrides,
  };
}

function createThread(overrides?: Partial<Thread>): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Existing thread",
    model: "gpt-5-codex",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: "2026-03-09T10:00:00.000Z",
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function createDraftThread(overrides?: Partial<DraftThreadState>): DraftThreadState {
  return {
    projectId: ProjectId.makeUnsafe("project-1"),
    createdAt: "2026-03-09T11:00:00.000Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    ...overrides,
  };
}

describe("threadDrafts", () => {
  it("surfaces a draft thread ahead of older persisted threads", () => {
    const project = createProject();
    const projectDraftThread = {
      threadId: ThreadId.makeUnsafe("draft-thread"),
      draftThread: createDraftThread(),
    };

    const projectThreads = buildProjectThreadList({
      project,
      threads: [
        createThread({
          id: ThreadId.makeUnsafe("thread-older"),
          createdAt: "2026-03-09T09:00:00.000Z",
        }),
      ],
      projectDraftThread,
    });

    expect(projectThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("draft-thread"),
      ThreadId.makeUnsafe("thread-older"),
    ]);
    expect(projectThreads[0]?.title).toBe("New thread");
  });

  it("does not duplicate a thread once the server copy exists", () => {
    const project = createProject();
    const threadId = ThreadId.makeUnsafe("thread-1");

    const projectThreads = buildProjectThreadList({
      project,
      threads: [createThread({ id: threadId })],
      projectDraftThread: {
        threadId,
        draftThread: createDraftThread(),
      },
    });

    expect(projectThreads).toHaveLength(1);
    expect(projectThreads[0]?.title).toBe("Existing thread");
  });

  it("builds a per-project draft map from persisted draft state", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("draft-thread");

    const draftThreads = buildProjectDraftThreadMap({
      draftThreadsByThreadId: {
        [threadId]: createDraftThread({ projectId }),
      },
      projectDraftThreadIdByProjectId: {
        [projectId]: threadId,
      },
    });

    expect(draftThreads.get(projectId)).toEqual({
      threadId,
      draftThread: expect.objectContaining({ projectId }),
    });
  });
});
