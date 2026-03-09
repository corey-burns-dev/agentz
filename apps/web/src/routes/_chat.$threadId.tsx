import { ThreadId } from "@agents/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	type CSSProperties,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
} from "react";
import {
	Sidebar,
	SidebarInset,
	SidebarProvider,
	SidebarRail,
} from "~/components/ui/sidebar";
import ChatView from "../components/ChatView";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { useComposerDraftStore } from "../composerDraftStore";
import {
	parseDiffRouteSearch,
	stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
	parseProjectDockRouteSearch,
	stripProjectDockSearchParams,
} from "../projectDockRouteSearch";
import { useStore } from "../store";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const ProjectDock = lazy(() => import("../components/ProjectDock"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const PROJECT_DOCK_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const PROJECT_DOCK_INLINE_SIDEBAR_WIDTH_STORAGE_KEY =
	"chat_project_dock_sidebar_width";
const PROJECT_DOCK_INLINE_DEFAULT_WIDTH = "clamp(22rem,32vw,26rem)";
const PROJECT_DOCK_INLINE_SIDEBAR_MIN_WIDTH = 20 * 16;

const DiffPanelSheet = (props: {
	children: ReactNode;
	diffOpen: boolean;
	onCloseDiff: () => void;
}) => {
	return (
		<Sheet
			open={props.diffOpen}
			onOpenChange={(open) => {
				if (!open) {
					props.onCloseDiff();
				}
			}}
		>
			<SheetPopup
				side="right"
				showCloseButton={false}
				keepMounted
				className="w-[min(88vw,820px)] max-w-[820px] p-0"
			>
				{props.children}
			</SheetPopup>
		</Sheet>
	);
};

const DiffLoadingFallback = (props: { inline: boolean }) => {
	if (props.inline) {
		return (
			<div className="flex h-full min-h-0 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
				Loading diff viewer...
			</div>
		);
	}

	return (
		<aside className="flex h-full w-[560px] shrink-0 items-center justify-center border-l border-border bg-card px-4 text-center text-xs text-muted-foreground/70">
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
		<aside className="flex h-full w-[416px] shrink-0 items-center justify-center border-l border-border bg-card px-4 text-center text-xs text-muted-foreground/70">
			Loading project dock...
		</aside>
	);
};

const DiffPanelInlineSidebar = (props: {
	diffOpen: boolean;
	onCloseDiff: () => void;
	onOpenDiff: () => void;
}) => {
	const { diffOpen, onCloseDiff, onOpenDiff } = props;
	const onOpenChange = useCallback(
		(open: boolean) => {
			if (open) {
				onOpenDiff();
				return;
			}
			onCloseDiff();
		},
		[onCloseDiff, onOpenDiff],
	);
	const shouldAcceptInlineSidebarWidth = useCallback(
		({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
			const composerForm = document.querySelector<HTMLElement>(
				"[data-chat-composer-form='true']",
			);
			if (!composerForm) return true;
			const composerViewport = composerForm.parentElement;
			if (!composerViewport) return true;
			const previousSidebarWidth =
				wrapper.style.getPropertyValue("--sidebar-width");
			wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

			const viewportStyle = window.getComputedStyle(composerViewport);
			const viewportPaddingLeft =
				Number.parseFloat(viewportStyle.paddingLeft) || 0;
			const viewportPaddingRight =
				Number.parseFloat(viewportStyle.paddingRight) || 0;
			const viewportContentWidth = Math.max(
				0,
				composerViewport.clientWidth -
					viewportPaddingLeft -
					viewportPaddingRight,
			);
			const formRect = composerForm.getBoundingClientRect();
			const hasComposerOverflow =
				composerForm.scrollWidth > composerForm.clientWidth + 0.5;
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
			open={diffOpen}
			onOpenChange={onOpenChange}
			className="w-auto min-h-0 flex-none bg-transparent"
			style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as CSSProperties}
		>
			<Sidebar
				side="right"
				collapsible="offcanvas"
				className="border-l border-border bg-card text-foreground"
				resizable={{
					minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
					shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
					storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
				}}
			>
				<Suspense fallback={<DiffLoadingFallback inline />}>
					<DiffPanel mode="sidebar" />
				</Suspense>
				<SidebarRail />
			</Sidebar>
		</SidebarProvider>
	);
};

const ProjectDockSheet = (props: {
	children: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) => {
	return (
		<Sheet open={props.open} onOpenChange={props.onOpenChange}>
			<SheetPopup
				side="right"
				showCloseButton={false}
				keepMounted
				className="w-[min(92vw,420px)] max-w-[420px] p-0"
			>
				{props.children}
			</SheetPopup>
		</Sheet>
	);
};

const ProjectDockInlineSidebar = (props: {
	children: ReactNode;
	open: boolean;
	onClose: () => void;
	onOpen: () => void;
}) => {
	const { children, onClose, onOpen, open } = props;
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

	return (
		<SidebarProvider
			defaultOpen={false}
			open={open}
			onOpenChange={onOpenChange}
			className="w-auto min-h-0 flex-none bg-transparent"
			style={
				{
					"--sidebar-width": PROJECT_DOCK_INLINE_DEFAULT_WIDTH,
				} as CSSProperties
			}
		>
			<Sidebar
				side="right"
				collapsible="offcanvas"
				className="border-l border-border bg-card text-foreground"
				resizable={{
					minWidth: PROJECT_DOCK_INLINE_SIDEBAR_MIN_WIDTH,
					storageKey: PROJECT_DOCK_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
				}}
			>
				{children}
				<SidebarRail />
			</Sidebar>
		</SidebarProvider>
	);
};

function ChatThreadRouteView() {
	const threadsHydrated = useStore((store) => store.threadsHydrated);
	const navigate = useNavigate();
	const threadId = Route.useParams({
		select: (params) => ThreadId.makeUnsafe(params.threadId),
	});
	const search = Route.useSearch();
	const threadExists = useStore((store) =>
		store.threads.some((thread) => thread.id === threadId),
	);
	const draftThreadExists = useComposerDraftStore((store) =>
		Object.hasOwn(store.draftThreadsByThreadId, threadId),
	);
	const routeThreadExists = threadExists || draftThreadExists;
	const diffOpen = search.diff === "1";
	const projectDockOpen = search.projectDock === "1" && !diffOpen;
	const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
	const shouldUseProjectDockSheet = useMediaQuery(
		PROJECT_DOCK_INLINE_LAYOUT_MEDIA_QUERY,
	);
	const closeDiff = useCallback(() => {
		void navigate({
			to: "/$threadId",
			params: { threadId },
			search: (previous) => {
				return stripDiffSearchParams(previous);
			},
		});
	}, [navigate, threadId]);
	const openDiff = useCallback(() => {
		void navigate({
			to: "/$threadId",
			params: { threadId },
			search: (previous) => {
				const rest = stripProjectDockSearchParams(
					stripDiffSearchParams(previous),
				);
				return { ...rest, diff: "1" };
			},
		});
	}, [navigate, threadId]);
	const closeProjectDock = useCallback(() => {
		void navigate({
			to: "/$threadId",
			params: { threadId },
			search: (previous) => stripProjectDockSearchParams(previous),
		});
	}, [navigate, threadId]);
	const openProjectDock = useCallback(() => {
		void navigate({
			to: "/$threadId",
			params: { threadId },
			search: (previous) => {
				const rest = stripDiffSearchParams(
					stripProjectDockSearchParams(previous),
				);
				return { ...rest, projectDock: "1", projectDockTab: "git" };
			},
		});
	}, [navigate, threadId]);

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

	if (!shouldUseDiffSheet) {
		return (
			<>
				<SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
					<ChatView key={threadId} threadId={threadId} />
				</SidebarInset>
				<DiffPanelInlineSidebar
					diffOpen={diffOpen}
					onCloseDiff={closeDiff}
					onOpenDiff={openDiff}
				/>
				<ProjectDockInlineSidebar
					open={projectDockOpen && !shouldUseProjectDockSheet}
					onClose={closeProjectDock}
					onOpen={openProjectDock}
				>
					{projectDockOpen ? (
						<Suspense fallback={<ProjectDockLoadingFallback inline />}>
							<ProjectDockRouteSlot onClose={closeProjectDock} />
						</Suspense>
					) : null}
				</ProjectDockInlineSidebar>
			</>
		);
	}

	return (
		<>
			<SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
				<ChatView key={threadId} threadId={threadId} />
			</SidebarInset>
			<DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
				<Suspense fallback={<DiffLoadingFallback inline={false} />}>
					<DiffPanel mode="sheet" />
				</Suspense>
			</DiffPanelSheet>
			<ProjectDockSheet
				open={projectDockOpen && shouldUseProjectDockSheet}
				onOpenChange={(open) => {
					if (open) {
						openProjectDock();
						return;
					}
					closeProjectDock();
				}}
			>
				{projectDockOpen ? (
					<Suspense fallback={<ProjectDockLoadingFallback inline={false} />}>
						<ProjectDockRouteSlot onClose={closeProjectDock} />
					</Suspense>
				) : null}
			</ProjectDockSheet>
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
	const activeProjectId =
		activeThread?.projectId ?? draftThread?.projectId ?? null;
	const activeProject = projects.find(
		(project) => project.id === activeProjectId,
	);
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
			workspaceCwd={workspaceCwd}
			{...(activeProject?.name ? { projectName: activeProject.name } : {})}
		/>
	);
}
