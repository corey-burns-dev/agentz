import type { GitStatusResult, ProjectEntry } from "@agents/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  FileIcon,
  FolderIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PanelRightCloseIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { gitBranchesQueryOptions, gitStatusQueryOptions } from "~/lib/gitReactQuery";
import {
  projectSearchEntriesQueryOptions,
  projectWriteFileMutationOptions,
} from "~/lib/projectReactQuery";
import { projectTodoFileQueryOptions } from "~/lib/projectTodoReactQuery";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import type { ProjectTodoItem } from "~/projectTodos";
import {
  appendProjectTodoItem,
  parseProjectTodoItems,
  toggleProjectTodoCompletion,
} from "~/projectTodos";
import { preferredTerminalEditor, resolvePathLinkTarget } from "~/terminal-links";
import type { ProjectDockTab } from "../projectDockRouteSearch";
import {
  type PerProjectNotificationSettings,
  useProjectNotificationSettings,
} from "../projectNotificationSettings";
import type { Project } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";

type SectionKey = "branch" | "notifications" | "todos";

const DOCK_SECTION_PADDING = "p-2";
const DOCK_SECTION_GAP = "space-y-2";
const DOCK_HEADER_PY = "py-1";

function loadCollapsedSections(): Record<SectionKey, boolean> {
  try {
    const v = localStorage.getItem("dock.sections");
    if (v) return JSON.parse(v) as Record<SectionKey, boolean>;
  } catch {
    // ignore
  }
  return { branch: false, notifications: false, todos: false };
}

interface WorkspaceTreeNode {
  children: WorkspaceTreeNode[];
  kind: ProjectEntry["kind"];
  name: string;
  path: string;
}

interface ProjectDockProps {
  activeTab: ProjectDockTab;
  gitCwd: string | null;
  onClose: () => void;
  onTabChange: (tab: ProjectDockTab) => void;
  project: Project | null;
  workspaceCwd: string | null;
}

const FILE_TREE_FETCH_LIMIT = 5_000;

function compareTreeNodes(left: WorkspaceTreeNode, right: WorkspaceTreeNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function buildWorkspaceTree(entries: readonly ProjectEntry[]): WorkspaceTreeNode[] {
  const nodeByPath = new Map<string, WorkspaceTreeNode>();
  const roots: WorkspaceTreeNode[] = [];

  const ensureNode = (path: string, kind: ProjectEntry["kind"]): WorkspaceTreeNode => {
    const existing = nodeByPath.get(path);
    if (existing) {
      existing.kind = kind;
      return existing;
    }

    const node: WorkspaceTreeNode = {
      path,
      kind,
      name: basenameOf(path),
      children: [],
    };
    nodeByPath.set(path, node);

    const parentPath = parentPathOf(path);
    if (parentPath) {
      const parent = ensureNode(parentPath, "directory");
      if (!parent.children.some((child) => child.path === path)) {
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }

    return node;
  };

  for (const entry of [...entries].toSorted((left, right) => {
    if (left.path === right.path) {
      if (left.kind === right.kind) return 0;
      return left.kind === "directory" ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
  })) {
    ensureNode(entry.path, entry.kind);
  }

  const sortNodes = (nodes: WorkspaceTreeNode[]) => {
    nodes.sort(compareTreeNodes);
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(roots);
  return roots;
}

function filterWorkspaceTree(
  nodes: readonly WorkspaceTreeNode[],
  query: string,
): {
  nodes: WorkspaceTreeNode[];
} {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return { nodes: [...nodes] };
  }

  const visit = (node: WorkspaceTreeNode): WorkspaceTreeNode | null => {
    const matchesSelf =
      node.name.toLowerCase().includes(normalizedQuery) ||
      node.path.toLowerCase().includes(normalizedQuery);
    const children = node.children
      .map(visit)
      .filter((child): child is WorkspaceTreeNode => child !== null);

    if (!matchesSelf && children.length === 0) {
      return null;
    }

    return {
      ...node,
      children,
    };
  };

  return {
    nodes: nodes.map(visit).filter((node): node is WorkspaceTreeNode => node !== null),
  };
}

function statusToneClasses(state: "open" | "closed" | "merged") {
  if (state === "open") {
    return "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  }
  if (state === "merged") {
    return "border-violet-500/30 bg-violet-500/12 text-violet-700 dark:text-violet-300";
  }
  return "border-border/70 bg-muted/50 text-muted-foreground";
}

function projectNotificationSummary(settings: PerProjectNotificationSettings): string {
  if (settings.disabled) {
    return "Notifications are disabled for this project.";
  }
  const notifyComplete = settings.notifyOnTurnComplete !== false;
  const notifyError = settings.notifyOnError !== false;
  if (notifyComplete && notifyError) {
    return "Using default notifications for completed turns and errors.";
  }
  if (!notifyComplete && notifyError) {
    return "Only error notifications are enabled for this project.";
  }
  if (notifyComplete && !notifyError) {
    return "Only completion notifications are enabled for this project.";
  }
  return "Per-project notifications are muted.";
}

function DockSection(props: {
  action?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
  collapsed: boolean;
  grow?: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-background/55",
        props.grow && !props.collapsed && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-border/60 px-3",
          DOCK_HEADER_PY,
        )}
      >
        <button
          type="button"
          onClick={props.onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!props.collapsed}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !props.collapsed && "rotate-90",
            )}
          />
          <p className="truncate text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {props.title}
          </p>
        </button>
        {props.action}
      </div>
      {props.collapsed ? null : (
        <div
          className={cn(
            "min-h-0 px-3 pb-3",
            props.grow && "flex min-h-0 flex-1 flex-col",
            props.bodyClassName,
          )}
        >
          {props.children}
        </div>
      )}
    </section>
  );
}

function GitSummaryCard(props: {
  gitStatus: GitStatusResult | null;
  gitStatusError: Error | null;
  isRepo: boolean;
}) {
  if (!props.isRepo) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
        This project is not a git repository.
      </div>
    );
  }

  if (props.gitStatusError) {
    return (
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive/85">
        {props.gitStatusError.message}
      </div>
    );
  }

  if (!props.gitStatus) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
        Loading repository status...
      </div>
    );
  }

  const { gitStatus } = props;

  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Branch
          </p>
          <p className="truncate pt-1 font-medium text-sm text-foreground">
            {gitStatus.branch ?? "Detached HEAD"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>↑{gitStatus.aheadCount}</span>
          <span>↓{gitStatus.behindCount}</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Changed files</p>
          <p className="pt-1 font-medium text-sm">{gitStatus.workingTree.files.length}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Working tree</p>
          <p className="pt-1 font-medium text-sm">
            {gitStatus.hasWorkingTreeChanges ? "Dirty" : "Clean"}
          </p>
        </div>
      </div>
      {gitStatus.pr ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-background/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GitPullRequestIcon className="size-3.5 text-muted-foreground" />
                <Badge
                  variant="outline"
                  className={cn("border text-2xs", statusToneClasses(gitStatus.pr.state))}
                >
                  {gitStatus.pr.state}
                </Badge>
                <span className="text-xs text-muted-foreground">PR #{gitStatus.pr.number}</span>
              </div>
              <p className="pt-2 font-medium text-sm leading-snug">{gitStatus.pr.title}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ProjectDock = memo(function ProjectDock({
  activeTab,
  gitCwd,
  onClose,
  onTabChange,
  project,
  workspaceCwd,
}: ProjectDockProps) {
  const [fileFilter, setFileFilter] = useState("");
  const [newTodoText, setNewTodoText] = useState("");
  const [collapsedSections, setCollapsedSections] =
    useState<Record<SectionKey, boolean>>(loadCollapsedSections);

  const toggleSection = useCallback((section: SectionKey) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      try {
        localStorage.setItem("dock.sections", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const shouldLoadTodoData = activeTab === "git" && workspaceCwd !== null;
  const notificationProjectKey = workspaceCwd;
  const queryClient = useQueryClient();
  const {
    settings: projectNotificationSettings,
    updateSettings: updateProjectNotificationSettings,
  } = useProjectNotificationSettings(notificationProjectKey);

  const { data: branchList = null } = useQuery(gitBranchesQueryOptions(gitCwd));
  const isRepo = gitCwd === null ? false : (branchList?.isRepo ?? true);
  const { data: gitStatus = null, error: gitStatusError } = useQuery(gitStatusQueryOptions(gitCwd));
  const projectTodoFileQuery = useQuery(
    projectTodoFileQueryOptions({
      cwd: workspaceCwd,
      enabled: shouldLoadTodoData,
    }),
  );
  const writeTodoFileMutation = useMutation(
    projectWriteFileMutationOptions({
      cwd: workspaceCwd,
      queryClient,
    }),
  );
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceCwd,
      query: "",
      allowEmptyQuery: true,
      enabled: activeTab === "files",
      limit: FILE_TREE_FETCH_LIMIT,
    }),
  );
  const todoItems = useMemo(
    () => parseProjectTodoItems(projectTodoFileQuery.data?.contents ?? null),
    [projectTodoFileQuery.data?.contents],
  );
  const openTodoItems = useMemo(() => todoItems.filter((item) => !item.completed), [todoItems]);
  const completedTodoItems = useMemo(() => todoItems.filter((item) => item.completed), [todoItems]);

  const workspaceTree = useMemo(
    () => buildWorkspaceTree(workspaceEntriesQuery.data?.entries ?? []),
    [workspaceEntriesQuery.data?.entries],
  );
  const filteredWorkspaceTree = useMemo(
    () => filterWorkspaceTree(workspaceTree, fileFilter).nodes,
    [fileFilter, workspaceTree],
  );
  const isFilteringFiles = fileFilter.trim().length > 0;

  useEffect(() => {
    if (Object.keys(expandedDirectories).length > 0 || workspaceTree.length === 0) {
      return;
    }
    setExpandedDirectories(
      Object.fromEntries(
        workspaceTree
          .filter((node) => node.kind === "directory")
          .slice(0, 8)
          .map((node) => [node.path, true]),
      ),
    );
  }, [expandedDirectories, workspaceTree]);

  const openWorkspaceEntry = useCallback(
    (relativePath: string) => {
      const api = readNativeApi();
      if (!api || !workspaceCwd) {
        toastManager.add({
          type: "error",
          title: "Editor integration is unavailable.",
        });
        return;
      }
      const targetPath = resolvePathLinkTarget(relativePath, workspaceCwd);
      void api.shell.openInEditor(targetPath, preferredTerminalEditor()).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    },
    [workspaceCwd],
  );

  const handleTodoSubmit = useCallback(() => {
    if (!workspaceCwd) {
      toastManager.add({
        type: "error",
        title: "Project todos are unavailable.",
      });
      return;
    }

    const todoText = newTodoText.trim();
    if (todoText.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Enter a todo",
      });
      return;
    }

    const relativePath = projectTodoFileQuery.data?.relativePath ?? "TODO.md";
    const contents = appendProjectTodoItem(projectTodoFileQuery.data?.contents ?? null, todoText);

    writeTodoFileMutation.mutate(
      {
        relativePath,
        contents,
      },
      {
        onSuccess: () => {
          setNewTodoText("");
          toastManager.add({
            type: "success",
            title: projectTodoFileQuery.data?.exists === true ? "Todo added" : "Todo file created",
            description: relativePath,
          });
        },
        onError: (error) => {
          toastManager.add({
            type: "error",
            title: "Could not save todo",
            description: error instanceof Error ? error.message : "An error occurred while saving.",
          });
        },
      },
    );
  }, [
    newTodoText,
    projectTodoFileQuery.data?.contents,
    projectTodoFileQuery.data?.exists,
    projectTodoFileQuery.data?.relativePath,
    workspaceCwd,
    writeTodoFileMutation,
  ]);

  const handleToggleTodoItem = useCallback(
    (item: ProjectTodoItem) => {
      if (!workspaceCwd) {
        toastManager.add({
          type: "error",
          title: "Project todos are unavailable.",
        });
        return;
      }

      const existingContents = projectTodoFileQuery.data?.contents ?? null;
      if (!existingContents) {
        return;
      }

      const relativePath = projectTodoFileQuery.data?.relativePath ?? "TODO.md";
      const contents = toggleProjectTodoCompletion(existingContents, item.lineIndex);

      if (contents === existingContents) {
        return;
      }

      writeTodoFileMutation.mutate(
        {
          relativePath,
          contents,
        },
        {
          onError: (error) => {
            toastManager.add({
              type: "error",
              title: "Could not update todo",
              description:
                error instanceof Error
                  ? error.message
                  : "An error occurred while updating the todo.",
            });
          },
        },
      );
    },
    [
      projectTodoFileQuery.data?.contents,
      projectTodoFileQuery.data?.relativePath,
      workspaceCwd,
      writeTodoFileMutation,
    ],
  );

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirectories((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }, []);

  const renderTree = useCallback(
    (nodes: readonly WorkspaceTreeNode[], depth = 0): ReactNode =>
      nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <button
              key={node.path}
              type="button"
              onClick={() => openWorkspaceEntry(node.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition hover:bg-accent hover:text-accent-foreground"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              title={node.path}
            >
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{node.name}</span>
            </button>
          );
        }

        const isExpanded = isFilteringFiles || expandedDirectories[node.path];
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => toggleDirectory(node.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/90 transition hover:bg-accent hover:text-accent-foreground"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              title={node.path}
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{node.name}</span>
            </button>
            {isExpanded ? renderTree(node.children, depth + 1) : null}
          </div>
        );
      }),
    [expandedDirectories, isFilteringFiles, openWorkspaceEntry, toggleDirectory],
  );

  return (
    <div className="flex h-full w-full shrink-0 flex-col border-l border-border/70 bg-card/60 text-foreground backdrop-blur-sm">
      <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
        <button
          type="button"
          onClick={() => onTabChange("git")}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
            activeTab === "git"
              ? "border-border bg-background text-foreground shadow-sm"
              : "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <GitBranchIcon className="size-3.5" />
          Git + Todos
        </button>
        <button
          type="button"
          onClick={() => onTabChange("files")}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
            activeTab === "files"
              ? "border-border bg-background text-foreground shadow-sm"
              : "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <FolderTreeIcon className="size-3.5" />
          Files
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {activeTab === "git" ? (
          <div className={cn("flex min-h-full flex-col", DOCK_SECTION_PADDING, DOCK_SECTION_GAP)}>
            <DockSection
              title="Branch"
              collapsed={collapsedSections.branch}
              onToggle={() => toggleSection("branch")}
            >
              <div className="pt-3">
                <GitSummaryCard
                  gitStatus={gitStatus}
                  gitStatusError={gitStatusError}
                  isRepo={isRepo}
                />
              </div>
            </DockSection>

            {isRepo && notificationProjectKey ? (
              <DockSection
                title="Notifications"
                collapsed={collapsedSections.notifications}
                onToggle={() => toggleSection("notifications")}
              >
                <div className="space-y-2 pt-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        Per-project alerts
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {projectNotificationSummary(projectNotificationSettings)}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant={projectNotificationSettings.disabled ? "outline" : "ghost"}
                      onClick={() =>
                        updateProjectNotificationSettings({
                          disabled: !projectNotificationSettings.disabled,
                        })
                      }
                    >
                      {projectNotificationSettings.disabled ? "Enable" : "Mute"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        updateProjectNotificationSettings({
                          notifyOnTurnComplete:
                            projectNotificationSettings.notifyOnTurnComplete === false,
                        })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition",
                        projectNotificationSettings.notifyOnTurnComplete !== false &&
                          !projectNotificationSettings.disabled
                          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-border/70 bg-muted/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span>Completed turns</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateProjectNotificationSettings({
                          notifyOnError: projectNotificationSettings.notifyOnError === false,
                        })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition",
                        projectNotificationSettings.notifyOnError !== false &&
                          !projectNotificationSettings.disabled
                          ? "border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                          : "border-border/70 bg-muted/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <span>Errors</span>
                    </button>
                  </div>
                </div>
              </DockSection>
            ) : null}

            <DockSection
              title="Todos"
              collapsed={collapsedSections.todos}
              onToggle={() => toggleSection("todos")}
              grow
              action={
                projectTodoFileQuery.data?.exists ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      openWorkspaceEntry(projectTodoFileQuery.data?.relativePath ?? "TODO.md")
                    }
                  >
                    Open file
                  </Button>
                ) : undefined
              }
            >
              <div className="flex min-h-0 flex-1 flex-col space-y-2 pt-3">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleTodoSubmit();
                  }}
                >
                  <Input
                    value={newTodoText}
                    onChange={(event) => setNewTodoText(event.target.value)}
                    placeholder="Add a project todo"
                    className="font-sans text-sm"
                    disabled={!workspaceCwd || writeTodoFileMutation.isPending}
                  />
                  <Button
                    type="submit"
                    size="xs"
                    disabled={
                      !workspaceCwd ||
                      writeTodoFileMutation.isPending ||
                      newTodoText.trim().length === 0
                    }
                  >
                    <PlusIcon className="size-3.5" />
                    Add task
                  </Button>
                </form>

                {!workspaceCwd ? (
                  <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
                    Project todos are unavailable because this thread has no workspace root.
                  </div>
                ) : projectTodoFileQuery.error ? (
                  <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive/85">
                    {projectTodoFileQuery.error instanceof Error
                      ? projectTodoFileQuery.error.message
                      : "Could not load project todos."}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="rounded-md text-2xs">
                        {openTodoItems.length} open
                      </Badge>
                      <Badge variant="secondary" className="rounded-md text-2xs">
                        {completedTodoItems.length} done
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="rounded-md text-2xs"
                        render={
                          <button
                            type="button"
                            onClick={() =>
                              openWorkspaceEntry(
                                projectTodoFileQuery.data?.relativePath ?? "TODO.md",
                              )
                            }
                            title="Open todo file in your editor"
                          />
                        }
                      >
                        {projectTodoFileQuery.data?.relativePath ?? "TODO.md"}
                      </Badge>
                    </div>

                    <ScrollArea className="min-h-0 flex-1">
                      {todoItems.length > 0 ? (
                        <div className="space-y-2">
                          {todoItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleToggleTodoItem(item)}
                              disabled={writeTodoFileMutation.isPending}
                              className={cn(
                                "flex w-full items-start gap-2 rounded-xl border border-border/70 bg-background/70 p-3 text-left transition",
                                writeTodoFileMutation.isPending && "cursor-wait opacity-70",
                              )}
                            >
                              {item.completed ? (
                                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0">
                                <p
                                  className={cn(
                                    "text-sm leading-snug",
                                    item.completed && "text-muted-foreground line-through",
                                  )}
                                >
                                  {item.text}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
                          {projectTodoFileQuery.isLoading
                            ? "Loading todos..."
                            : projectTodoFileQuery.data?.exists
                              ? "No markdown checklist items found in the todo file yet."
                              : "No todo file yet. Add your first task and Agents will create TODO.md in the project root."}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </div>
            </DockSection>
          </div>
        ) : (
          <div className={cn(DOCK_SECTION_GAP, DOCK_SECTION_PADDING)}>
            <div className="relative">
              <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
              <Input
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
                placeholder="Filter files and folders"
                className="pl-9"
              />
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{workspaceEntriesQuery.data?.entries.length ?? 0} entries</span>
              {workspaceEntriesQuery.data?.truncated ? (
                <span>Showing first {FILE_TREE_FETCH_LIMIT.toLocaleString()}</span>
              ) : null}
            </div>

            {workspaceEntriesQuery.error ? (
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive/85">
                {workspaceEntriesQuery.error instanceof Error
                  ? workspaceEntriesQuery.error.message
                  : "Could not load workspace entries."}
              </div>
            ) : workspaceEntriesQuery.isLoading ? (
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
                Loading workspace tree...
              </div>
            ) : filteredWorkspaceTree.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
                No files or folders match this filter.
              </div>
            ) : (
              <div className="rounded-xl border border-border/70 bg-background/70 py-2">
                {renderTree(filteredWorkspaceTree)}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        {activeTab === "files"
          ? "Click a file to open it in your preferred editor."
          : "Use the dock to review repo status and manage project todos."}
      </div>
    </div>
  );
});

export default ProjectDock;
