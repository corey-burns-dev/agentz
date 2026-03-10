import { describe, expect, it } from "vitest";

import {
  getProjectThreadArchiveAction,
  isProjectThreadArchiveActionId,
  resolveProjectThreadsToArchive,
  sortProjectThreadsNewestFirst,
} from "./projectThreadArchiveActions";
import type { Thread } from "./types";

function buildThread(overrides: Partial<Thread>): Thread {
  return {
    id: "thread-1" as Thread["id"],
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: "Thread",
    model: "gpt-5",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-10T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("projectThreadArchiveActions", () => {
  it("recognizes supported action ids", () => {
    expect(isProjectThreadArchiveActionId("archive-all")).toBe(true);
    expect(isProjectThreadArchiveActionId("keep-5")).toBe(true);
    expect(isProjectThreadArchiveActionId("delete")).toBe(false);
    expect(isProjectThreadArchiveActionId(null)).toBe(false);
  });

  it("sorts project threads newest-first and ignores other projects", () => {
    const threads = [
      buildThread({
        id: "thread-1" as Thread["id"],
        projectId: "project-1" as Thread["projectId"],
        createdAt: "2026-03-10T10:00:00.000Z",
      }),
      buildThread({
        id: "thread-3" as Thread["id"],
        projectId: "project-2" as Thread["projectId"],
        createdAt: "2026-03-10T12:00:00.000Z",
      }),
      buildThread({
        id: "thread-2" as Thread["id"],
        projectId: "project-1" as Thread["projectId"],
        createdAt: "2026-03-10T11:00:00.000Z",
      }),
    ];

    expect(
      sortProjectThreadsNewestFirst(threads, "project-1" as Thread["projectId"]).map(
        (thread) => thread.id,
      ),
    ).toEqual(["thread-2", "thread-1"]);
  });

  it("archives everything for archive-all", () => {
    const threads = [
      buildThread({ id: "thread-1" as Thread["id"] }),
      buildThread({ id: "thread-2" as Thread["id"] }),
    ];

    expect(resolveProjectThreadsToArchive("archive-all", threads)).toEqual({
      keepCount: null,
      threadsToArchive: threads,
    });
  });

  it("keeps the requested number of newest threads", () => {
    const threads = [
      buildThread({ id: "thread-4" as Thread["id"] }),
      buildThread({ id: "thread-3" as Thread["id"] }),
      buildThread({ id: "thread-2" as Thread["id"] }),
      buildThread({ id: "thread-1" as Thread["id"] }),
    ];

    expect(resolveProjectThreadsToArchive("keep-3", threads)).toEqual({
      keepCount: getProjectThreadArchiveAction("keep-3").keepCount,
      threadsToArchive: [threads[3]],
    });
  });
});
