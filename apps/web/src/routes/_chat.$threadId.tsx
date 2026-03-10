import { ThreadId } from "@agents/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DiffIcon, FolderTreeIcon, PanelRightCloseIcon } from "lucide-react";
import { type CSSProperties, lazy, type ReactNode, Suspense, useCallback, useEffect } from "react";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import {
  parseProjectDockRouteSearch,
  stripProjectDockSearchParams,
} from "../projectDockRouteSearch";
import { useStore } from "../store";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const ProjectDock = lazy(() => import("../components/ProjectDock"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const RIGHT_DOCK_WIDTH_STORAGE_KEY = "chat_right_dock_width";
const RIGHT_DOCK_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const RIGHT_DOCK_MIN_WIDTH = 26 * 16;

const DiffLoadingFallback = (props: { inline: boolean }) => {
  if (props.inline) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
        Loading diff viewer...
      </div>
    );
  }

  return (
    <aside className="flex h-full w-140 shrink-0 items-center justify-center border-l border-border bg-card px-4 text-center text-xs text-muted-foreground/70">
      Loading diff viewer...
    </aside>
  );
};

const ProjectDockLoadingFallback = (props: { inline: boolean }) => {
  if (props.inline) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
        Loading project dock...
      </div>
    );
  }

  return (
    <aside className="flex h-full w-104 shrink-0 items-center justify-center border-l border-border bg-card px-4 text-center text-xs text-muted-foreground/70">
      Loading project dock...
    </aside>
  );
};

type RightDockPane = "diff" | "project";

const RightDockInlineSidebar = (props: {
  open: boolean;
  pane: RightDockPane;
  onClose: () => void;
  onOpen: () => void;
  onSwitchToDiff: () => void;
  onSwitchToProject: () => void;
  canShowDiff: boolean;
  canShowProject: boolean;
  projectDockContent: ReactNode;
}) => {
  const {
    open,
    pane,
    onClose,
    onOpen,
    onSwitchToDiff,
    onSwitchToProject,
    canShowDiff,
    canShowProject,
    projectDockContent,
  } = props;
  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpen();
        return;
      }
      onClose();
    },
    [onClose, onOpen],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": RIGHT_DOCK_DEFAULT_WIDTH } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: RIGHT_DOCK_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: RIGHT_DOCK_WIDTH_STORAGE_KEY,
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      variant={pane === "diff" ? "secondary" : "ghost"}
                      className={cn("h-8 gap-2 px-3", pane === "diff" && "bg-background shadow-sm")}
                      onClick={onSwitchToDiff}
                      disabled={!canShowDiff}
                      aria-label="Diff view"
                    >
                      <DiffIcon className="size-4" />
                      <span className="text-xs font-medium">Diff</span>
                    </Button>
                  }
                />
                <TooltipPopup side="bottom">
                  {canShowDiff ? "Diff view" : "Diff is unavailable (not a git repo)."}
                </TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      variant={pane === "project" ? "secondary" : "ghost"}
                      className={cn(
                        "h-8 gap-2 px-3",
                        pane === "project" && "bg-background shadow-sm",
                      )}
                      onClick={onSwitchToProject}
                      disabled={!canShowProject}
                      aria-label="Project dock"
                    >
                      <FolderTreeIcon className="size-4" />
                      <span className="text-xs font-medium">Project</span>
                    </Button>
                  }
                />
                <TooltipPopup side="bottom">
                  {canShowProject ? "Project dock" : "Project dock is unavailable (no project)."}
                </TooltipPopup>
              </Tooltip>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={onClose}
                    aria-label="Close panel"
                  >
                    <PanelRightCloseIcon className="size-4" />
                  </Button>
                }
              />
              <TooltipPopup side="bottom">Close panel</TooltipPopup>
            </Tooltip>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            {pane === "diff" ? (
              <Suspense fallback={<DiffLoadingFallback inline />}>
                <DiffPanel mode="sidebar" />
              </Suspense>
            ) : (
              projectDockContent
            )}
          </div>
        </div>
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const RightDockSheet = (props: {
  open: boolean;
  pane: RightDockPane;
  onClose: () => void;
  onSwitchToDiff: () => void;
  onSwitchToProject: () => void;
  canShowDiff: boolean;
  canShowProject: boolean;
  diffContent: ReactNode;
  projectDockContent: ReactNode;
}) => {
  const {
    open,
    pane,
    onClose,
    onSwitchToDiff,
    onSwitchToProject,
    canShowDiff,
    canShowProject,
    diffContent,
    projectDockContent,
  } = props;
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="flex w-[min(92vw,820px)] max-w-205 flex-col p-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={pane === "diff" ? "secondary" : "ghost"}
              className={cn("gap-2", pane === "diff" && "bg-background shadow-sm")}
              onClick={onSwitchToDiff}
              disabled={!canShowDiff}
            >
              <DiffIcon className="size-4" />
              Diff
            </Button>
            <Button
              size="sm"
              variant={pane === "project" ? "secondary" : "ghost"}
              className={cn("gap-2", pane === "project" && "bg-background shadow-sm")}
              onClick={onSwitchToProject}
              disabled={!canShowProject}
            >
              <FolderTreeIcon className="size-4" />
              Project
            </Button>
          </div>
          <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close panel">
            <PanelRightCloseIcon className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {pane === "diff" ? diffContent : projectDockContent}
        </div>
      </SheetPopup>
    </Sheet>
  );
};

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;
  const diffOpen = search.diff === "1";
  const projectDockOpen = search.projectDock === "1" && !diffOpen;
  const rightDockOpen = diffOpen || projectDockOpen;
  const rightDockPane: RightDockPane = diffOpen ? "diff" : "project";
  const shouldUseRightDockSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);

  const closeRightDock = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripProjectDockSearchParams(stripDiffSearchParams(previous)) as Record<
          string,
          unknown
        >;
        return rest as typeof previous;
      },
    });
  }, [navigate, threadId]);

  const openRightDockWithPane = useCallback(
    (pane: RightDockPane) => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripProjectDockSearchParams(stripDiffSearchParams(previous));
          if (pane === "diff") {
            return { ...rest, diff: "1" };
          }
          return { ...rest, projectDock: "1", projectDockTab: "git" };
        },
      });
    },
    [navigate, threadId],
  );

  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const activeThread = threads.find((thread) => thread.id === threadId);
  const activeProjectId = activeThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const canShowProject = Boolean(activeProject);
  const canShowDiff = true;

  const openRightDock = useCallback(() => {
    openRightDockWithPane(canShowProject ? "project" : "diff");
  }, [openRightDockWithPane, canShowProject]);

  const projectDockContentNode = (
    <Suspense fallback={<ProjectDockLoadingFallback inline />}>
      <ProjectDockRouteSlot onClose={closeRightDock} />
    </Suspense>
  );

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
      return;
    }
  }, [navigate, routeThreadExists, threadsHydrated]);

  if (!threadsHydrated || !routeThreadExists) {
    return null;
  }

  if (!shouldUseRightDockSheet) {
    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView key={threadId} threadId={threadId} />
        </SidebarInset>
        <RightDockInlineSidebar
          open={rightDockOpen}
          pane={rightDockPane}
          onClose={closeRightDock}
          onOpen={openRightDock}
          onSwitchToDiff={() => openRightDockWithPane("diff")}
          onSwitchToProject={() => openRightDockWithPane("project")}
          canShowDiff={canShowDiff}
          canShowProject={canShowProject}
          projectDockContent={projectDockContentNode}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView key={threadId} threadId={threadId} />
      </SidebarInset>
      <RightDockSheet
        open={rightDockOpen}
        pane={rightDockPane}
        onClose={closeRightDock}
        onSwitchToDiff={() => openRightDockWithPane("diff")}
        onSwitchToProject={() => openRightDockWithPane("project")}
        canShowDiff={canShowDiff}
        canShowProject={canShowProject}
        diffContent={
          <Suspense fallback={<DiffLoadingFallback inline={false} />}>
            <DiffPanel mode="sheet" />
          </Suspense>
        }
        projectDockContent={
          <Suspense fallback={<ProjectDockLoadingFallback inline={false} />}>
            <ProjectDockRouteSlot onClose={closeRightDock} />
          </Suspense>
        }
      />
    </>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => ({
    ...parseDiffRouteSearch(search),
    ...parseProjectDockRouteSearch(search),
  }),
  component: ChatThreadRouteView,
});

function ProjectDockRouteSlot({ onClose }: { onClose: () => void }) {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const threads = useStore((store) => store.threads);
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const projects = useStore((store) => store.projects);
  const activeThread = threads.find((thread) => thread.id === threadId);
  const activeProjectId = activeThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const workspaceCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  return (
    <ProjectDock
      activeTab={search.projectDockTab ?? "git"}
      onTabChange={(tab) => {
        void navigate({
          to: "/$threadId",
          params: { threadId },
          search: (previous) => ({
            ...stripDiffSearchParams(stripProjectDockSearchParams(previous)),
            projectDock: "1",
            projectDockTab: tab,
          }),
        });
      }}
      onClose={onClose}
      gitCwd={workspaceCwd}
      project={activeProject ?? null}
      workspaceCwd={activeProject?.cwd ?? null}
    />
  );
}
