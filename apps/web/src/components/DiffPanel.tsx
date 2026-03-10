import { ThreadId, type TurnId } from "@agents/contracts";
import { parsePatchFiles } from "@pierre/diffs";
import {
	FileDiff,
	type FileDiffMetadata,
	Virtualizer,
} from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
	BetweenHorizontalStartIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	Columns2Icon,
	HashIcon,
	ListTreeIcon,
	Rows3Icon,
	SearchIcon,
	WrapTextIcon,
} from "lucide-react";
import {
	type CSSProperties,
	type WheelEvent as ReactWheelEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { gitBranchesQueryOptions } from "~/lib/gitReactQuery";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import {
	parseDiffRouteSearch,
	stripDiffSearchParams,
} from "../diffRouteSearch";
import { isDesktopShell } from "../env";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import {
	preferredTerminalEditor,
	resolvePathLinkTarget,
} from "../terminal-links";
import {
	DIFF_SIZE_OPTIONS,
	type DiffSizeOption,
	useUISettings,
} from "../uiSettings";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { toggleVariants } from "./ui/toggle";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

const DIFF_PANEL_UNSAFE_CSS = `
:host {
  --diffs-font-size: var(--diff-panel-font-size, 12.5px);
  --diffs-line-height: var(--diff-panel-line-height, 19px);
  --diffs-gap-inline: var(--diff-panel-gap-inline, 8px);
  --diffs-gap-block: var(--diff-panel-gap-block, 8px);
  --diffs-min-number-column-width-default: var(--diff-panel-min-number-width, 3ch);
}

[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  padding: var(--diff-panel-file-info-padding, 10px) !important;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  min-height: calc(1lh + (var(--diffs-gap-block, 8px) * 2.25)) !important;
  padding-inline: var(--diff-panel-header-padding-inline, 12px) !important;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-line],
[data-column-number],
[data-no-newline] {
  padding-inline: var(--diff-panel-line-padding-inline, 1ch) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

const DIFF_SIZE_LABELS: Record<DiffSizeOption, string> = {
	compact: "Tight",
	balanced: "Balanced",
	comfortable: "Large",
};

const DIFF_SIZE_INDEX_BY_OPTION: Record<DiffSizeOption, number> = {
	compact: 0,
	balanced: 1,
	comfortable: 2,
};

const DIFF_SIZE_OPTION_BY_INDEX: Record<number, DiffSizeOption> = {
	0: "compact",
	1: "balanced",
	2: "comfortable",
};

const DIFF_SIZE_TOKENS: Record<
	DiffSizeOption,
	{
		fileInfoPadding: number;
		fontSize: number;
		gapBlock: number;
		gapInline: number;
		headerPaddingInline: number;
		lineHeight: number;
		linePaddingInline: number;
		minNumberWidth: number;
	}
> = {
	compact: {
		fileInfoPadding: 8,
		fontSize: 11.5,
		gapBlock: 6,
		gapInline: 6,
		headerPaddingInline: 10,
		lineHeight: 17.5,
		linePaddingInline: 0.8,
		minNumberWidth: 2.25,
	},
	balanced: {
		fileInfoPadding: 9,
		fontSize: 12.25,
		gapBlock: 7.5,
		gapInline: 7.5,
		headerPaddingInline: 11,
		lineHeight: 18.75,
		linePaddingInline: 0.92,
		minNumberWidth: 2.6,
	},
	comfortable: {
		fileInfoPadding: 10,
		fontSize: 13.25,
		gapBlock: 9,
		gapInline: 9,
		headerPaddingInline: 12,
		lineHeight: 20.5,
		linePaddingInline: 1.05,
		minNumberWidth: 3,
	},
};

const DIFF_FORCE_WRAP_BREAKPOINT = 760;
const DIFF_FORCE_STACKED_BREAKPOINT = 960;
const DIFF_FORCE_HIDE_LINE_NUMBERS_BREAKPOINT = 560;
const DIFF_SIDEBAR_NAV_BREAKPOINT = 1060;

type RenderablePatch =
	| {
			kind: "files";
			files: FileDiffMetadata[];
	  }
	| {
			kind: "raw";
			reason: string;
			text: string;
	  };

interface DiffFileItem {
	additions: number;
	deletions: number;
	directory: string;
	name: string;
	path: string;
	type: FileDiffMetadata["type"];
}

interface DiffNavigatorFileButtonProps {
	item: DiffFileItem;
	selected: boolean;
	onSelect: (filePath: string) => void;
	variant?: "compact" | "sidebar";
}

function getRenderablePatch(
	patch: string | undefined,
	cacheScope = "diff-panel",
): RenderablePatch | null {
	if (!patch) return null;
	const normalizedPatch = patch.trim();
	if (normalizedPatch.length === 0) return null;

	try {
		const parsedPatches = parsePatchFiles(
			normalizedPatch,
			buildPatchCacheKey(normalizedPatch, cacheScope),
		);
		const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
		if (files.length > 0) {
			return { kind: "files", files };
		}

		return {
			kind: "raw",
			text: normalizedPatch,
			reason: "Unsupported diff format. Showing raw patch.",
		};
	} catch {
		return {
			kind: "raw",
			text: normalizedPatch,
			reason: "Failed to parse patch. Showing raw patch.",
		};
	}
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
	const raw = fileDiff.name ?? fileDiff.prevName ?? "";
	if (raw.startsWith("a/") || raw.startsWith("b/")) {
		return raw.slice(2);
	}
	return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
	return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function formatTurnChipTimestamp(isoDate: string): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(isoDate));
}

function summarizeFileDiff(fileDiff: FileDiffMetadata): {
	additions: number;
	deletions: number;
} {
	return fileDiff.hunks.reduce(
		(acc, hunk) => ({
			additions: acc.additions + hunk.additionLines,
			deletions: acc.deletions + hunk.deletionLines,
		}),
		{ additions: 0, deletions: 0 },
	);
}

function buildDiffFileItem(fileDiff: FileDiffMetadata): DiffFileItem {
	const path = resolveFileDiffPath(fileDiff);
	const lastSlashIndex = path.lastIndexOf("/");
	const { additions, deletions } = summarizeFileDiff(fileDiff);

	return {
		additions,
		deletions,
		directory: lastSlashIndex >= 0 ? path.slice(0, lastSlashIndex) : "",
		name: lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path,
		path,
		type: fileDiff.type,
	};
}

function matchDiffFile(item: DiffFileItem, normalizedQuery: string): boolean {
	if (normalizedQuery.length === 0) {
		return true;
	}
	return `${item.path} ${item.type}`.toLowerCase().includes(normalizedQuery);
}

function scrollToDiffFileInViewport(
	viewport: HTMLDivElement | null,
	filePath: string,
): void {
	if (!viewport) return;
	const target = Array.from(
		viewport.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
	).find((element) => element.dataset.diffFilePath === filePath);
	target?.scrollIntoView({ block: "nearest" });
}

function DiffNavigatorFileButton({
	item,
	selected,
	onSelect,
	variant = "compact",
}: DiffNavigatorFileButtonProps) {
	return (
		<button
			type="button"
			className={cn(
				"flex w-full items-start justify-between gap-2 rounded-lg text-left transition-colors",
				variant === "sidebar"
					? "px-2.5 py-2"
					: "border border-border/65 bg-background/55 px-2.5 py-2",
				selected
					? "bg-primary/10 text-foreground ring-1 ring-primary/45"
					: variant === "sidebar"
						? "text-muted-foreground hover:bg-accent/65 hover:text-foreground"
						: "text-muted-foreground hover:border-border hover:bg-accent/55 hover:text-foreground",
			)}
			onClick={() => onSelect(item.path)}
			title={item.path}
		>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[12px] font-medium">{item.name}</div>
				<div className="truncate text-2xs text-muted-foreground/72">
					{item.directory || item.type}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1 text-2xs font-medium tabular-nums">
				<span className="text-emerald-500/90">+{item.additions}</span>
				<span className="text-rose-500/90">-{item.deletions}</span>
			</div>
		</button>
	);
}

interface DiffPanelProps {
	mode?: "inline" | "sheet" | "sidebar";
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({ mode = "inline" }: DiffPanelProps) {
	const navigate = useNavigate();
	const { resolvedTheme } = useTheme();
	const { settings, updateUISettings } = useUISettings();
	const [diffRenderMode, setDiffRenderMode] =
		useState<DiffRenderMode>("stacked");
	const [fileQuery, setFileQuery] = useState("");
	const [isFileSearchExpanded, setIsFileSearchExpanded] = useState(false);
	const [panelWidth, setPanelWidth] = useState(0);
	const patchViewportRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const turnStripRef = useRef<HTMLDivElement>(null);
	const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
	const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
	const routeThreadId = useParams({
		strict: false,
		select: (params) =>
			params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
	});
	const diffSearch = useSearch({
		strict: false,
		select: (search) => parseDiffRouteSearch(search),
	});
	const activeThreadId = routeThreadId;
	const activeThread = useStore((store) =>
		activeThreadId
			? store.threads.find((thread) => thread.id === activeThreadId)
			: undefined,
	);
	const activeProjectId = activeThread?.projectId ?? null;
	const activeProject = useStore((store) =>
		activeProjectId
			? store.projects.find((project) => project.id === activeProjectId)
			: undefined,
	);
	const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
	const gitBranchesQuery = useQuery(gitBranchesQueryOptions(activeCwd ?? null));
	const isGitRepo = gitBranchesQuery.data?.isRepo ?? true;
	const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
		useTurnDiffSummaries(activeThread);
	const orderedTurnDiffSummaries = useMemo(
		() =>
			[...turnDiffSummaries].toSorted((left, right) => {
				const leftTurnCount =
					left.checkpointTurnCount ??
					inferredCheckpointTurnCountByTurnId[left.turnId] ??
					0;
				const rightTurnCount =
					right.checkpointTurnCount ??
					inferredCheckpointTurnCountByTurnId[right.turnId] ??
					0;
				if (leftTurnCount !== rightTurnCount) {
					return rightTurnCount - leftTurnCount;
				}
				return right.completedAt.localeCompare(left.completedAt);
			}),
		[inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
	);

	const selectedTurnId = diffSearch.diffTurnId ?? null;
	const selectedFilePath = diffSearch.diffFilePath ?? null;
	const selectedTurn =
		selectedTurnId === null
			? undefined
			: (orderedTurnDiffSummaries.find(
					(summary) => summary.turnId === selectedTurnId,
				) ?? orderedTurnDiffSummaries[0]);
	const selectedCheckpointTurnCount =
		selectedTurn &&
		(selectedTurn.checkpointTurnCount ??
			inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
	const selectedCheckpointRange = useMemo(
		() =>
			typeof selectedCheckpointTurnCount === "number"
				? {
						fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
						toTurnCount: selectedCheckpointTurnCount,
					}
				: null,
		[selectedCheckpointTurnCount],
	);
	const conversationCheckpointTurnCount = useMemo(() => {
		const turnCounts = orderedTurnDiffSummaries
			.map(
				(summary) =>
					summary.checkpointTurnCount ??
					inferredCheckpointTurnCountByTurnId[summary.turnId],
			)
			.filter((value): value is number => typeof value === "number");
		if (turnCounts.length === 0) {
			return undefined;
		}
		const latest = Math.max(...turnCounts);
		return latest > 0 ? latest : undefined;
	}, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
	const conversationCheckpointRange = useMemo(
		() =>
			!selectedTurn && typeof conversationCheckpointTurnCount === "number"
				? {
						fromTurnCount: 0,
						toTurnCount: conversationCheckpointTurnCount,
					}
				: null,
		[conversationCheckpointTurnCount, selectedTurn],
	);
	const activeCheckpointRange = selectedTurn
		? selectedCheckpointRange
		: conversationCheckpointRange;
	const conversationCacheScope = useMemo(() => {
		if (selectedTurn || orderedTurnDiffSummaries.length === 0) {
			return null;
		}
		return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
	}, [orderedTurnDiffSummaries, selectedTurn]);
	const activeCheckpointDiffQuery = useQuery(
		checkpointDiffQueryOptions({
			threadId: activeThreadId,
			fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
			toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
			cacheScope: selectedTurn
				? `turn:${selectedTurn.turnId}`
				: conversationCacheScope,
			enabled: isGitRepo,
		}),
	);
	const selectedTurnCheckpointDiff = selectedTurn
		? activeCheckpointDiffQuery.data?.diff
		: undefined;
	const conversationCheckpointDiff = selectedTurn
		? undefined
		: activeCheckpointDiffQuery.data?.diff;
	const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
	const checkpointDiffError =
		activeCheckpointDiffQuery.error instanceof Error
			? activeCheckpointDiffQuery.error.message
			: activeCheckpointDiffQuery.error
				? "Failed to load checkpoint diff."
				: null;

	const selectedPatch = selectedTurn
		? selectedTurnCheckpointDiff
		: conversationCheckpointDiff;
	const hasResolvedPatch = typeof selectedPatch === "string";
	const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
	const renderablePatch = useMemo(
		() => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
		[resolvedTheme, selectedPatch],
	);
	const renderableFiles = useMemo(() => {
		if (!renderablePatch || renderablePatch.kind !== "files") {
			return [];
		}
		return renderablePatch.files.toSorted((left, right) =>
			resolveFileDiffPath(left).localeCompare(
				resolveFileDiffPath(right),
				undefined,
				{
					numeric: true,
					sensitivity: "base",
				},
			),
		);
	}, [renderablePatch]);
	const diffFileItems = useMemo(
		() => renderableFiles.map(buildDiffFileItem),
		[renderableFiles],
	);
	const normalizedFileQuery = fileQuery.trim().toLowerCase();
	const visibleDiffFileItems = useMemo(
		() =>
			diffFileItems.filter((item) => matchDiffFile(item, normalizedFileQuery)),
		[diffFileItems, normalizedFileQuery],
	);
	const visibleFilePathSet = useMemo(
		() => new Set(visibleDiffFileItems.map((item) => item.path)),
		[visibleDiffFileItems],
	);
	const visibleRenderableFiles = useMemo(() => {
		if (normalizedFileQuery.length === 0) {
			return renderableFiles;
		}
		return renderableFiles.filter((fileDiff) =>
			visibleFilePathSet.has(resolveFileDiffPath(fileDiff)),
		);
	}, [normalizedFileQuery.length, renderableFiles, visibleFilePathSet]);
	const visibleFileStats = useMemo(
		() =>
			visibleDiffFileItems.reduce(
				(acc, item) => ({
					additions: acc.additions + item.additions,
					deletions: acc.deletions + item.deletions,
				}),
				{ additions: 0, deletions: 0 },
			),
		[visibleDiffFileItems],
	);
	const shouldForceWrap =
		panelWidth > 0 && panelWidth < DIFF_FORCE_WRAP_BREAKPOINT;
	const shouldForceStacked =
		panelWidth > 0 && panelWidth < DIFF_FORCE_STACKED_BREAKPOINT;
	const shouldForceHideLineNumbers =
		panelWidth > 0 && panelWidth < DIFF_FORCE_HIDE_LINE_NUMBERS_BREAKPOINT;
	const effectiveDiffRenderMode = shouldForceStacked
		? "stacked"
		: diffRenderMode;
	const effectiveWrap = shouldForceWrap || settings.diffWrap;
	const effectiveShowLineNumbers =
		!shouldForceHideLineNumbers && settings.diffShowLineNumbers;
	const canShowFileNavigator =
		settings.diffShowFileNavigator && visibleDiffFileItems.length > 1;
	const showSidebarNavigator =
		canShowFileNavigator &&
		mode !== "inline" &&
		panelWidth >= DIFF_SIDEBAR_NAV_BREAKPOINT;
	const showCompactNavigator = canShowFileNavigator && !showSidebarNavigator;
	const forcedBehaviorHints = [
		shouldForceStacked ? "Auto stacked" : null,
		shouldForceWrap ? "Auto wrap" : null,
		shouldForceHideLineNumbers ? "Hide lines" : null,
	].filter((value): value is string => value !== null);
	const diffSizeSliderValue = DIFF_SIZE_INDEX_BY_OPTION[settings.diffSize];
	const diffSurfaceStyle = useMemo(() => {
		const preset = DIFF_SIZE_TOKENS[settings.diffSize];
		const widthScale =
			panelWidth > 0 && panelWidth < DIFF_FORCE_HIDE_LINE_NUMBERS_BREAKPOINT
				? 0.94
				: panelWidth > 0 && panelWidth < DIFF_FORCE_STACKED_BREAKPOINT
					? 0.98
					: 1;

		return {
			"--diff-panel-file-info-padding": `${Math.max(
				7,
				preset.fileInfoPadding * widthScale,
			)}px`,
			"--diff-panel-font-size": `${(preset.fontSize * widthScale).toFixed(
				2,
			)}px`,
			"--diff-panel-gap-block": `${(preset.gapBlock * widthScale).toFixed(
				2,
			)}px`,
			"--diff-panel-gap-inline": `${(preset.gapInline * widthScale).toFixed(
				2,
			)}px`,
			"--diff-panel-header-padding-inline": `${Math.max(
				9,
				preset.headerPaddingInline * widthScale,
			)}px`,
			"--diff-panel-line-height": `${(preset.lineHeight * widthScale).toFixed(
				2,
			)}px`,
			"--diff-panel-line-padding-inline": `${(
				preset.linePaddingInline * widthScale
			).toFixed(2)}ch`,
			"--diff-panel-min-number-width": `${(
				preset.minNumberWidth * widthScale
			).toFixed(2)}ch`,
		} as CSSProperties;
	}, [panelWidth, settings.diffSize]);

	useEffect(() => {
		const element = panelRef.current;
		if (!element) return;

		const updatePanelWidth = () => {
			setPanelWidth((current) => {
				const next = Math.round(element.clientWidth);
				return current === next ? current : next;
			});
		};

		updatePanelWidth();
		const resizeObserver = new ResizeObserver(updatePanelWidth);
		resizeObserver.observe(element);
		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	const scrollToDiffFile = useCallback((filePath: string) => {
		scrollToDiffFileInViewport(patchViewportRef.current, filePath);
	}, []);

	useEffect(() => {
		if (!selectedFilePath) {
			return;
		}
		scrollToDiffFile(selectedFilePath);
	}, [scrollToDiffFile, selectedFilePath]);

	const openDiffFileInEditor = useCallback(
		(filePath: string) => {
			const api = readNativeApi();
			if (!api) return;
			const targetPath = activeCwd
				? resolvePathLinkTarget(filePath, activeCwd)
				: filePath;
			void api.shell
				.openInEditor(targetPath, preferredTerminalEditor())
				.catch((error) => {
					console.warn("Failed to open diff file in editor.", error);
				});
		},
		[activeCwd],
	);

	const updateSelectedFilePath = useCallback(
		(filePath: string | null) => {
			if (!activeThread) return;
			void navigate({
				to: "/$threadId",
				params: { threadId: activeThread.id },
				search: (previous) => {
					const rest = stripDiffSearchParams(previous);
					return {
						...rest,
						diff: "1",
						...(selectedTurn ? { diffTurnId: selectedTurn.turnId } : {}),
						...(filePath ? { diffFilePath: filePath } : {}),
					};
				},
			});
		},
		[activeThread, navigate, selectedTurn],
	);

	const selectDiffFile = useCallback(
		(filePath: string) => {
			scrollToDiffFile(filePath);
			updateSelectedFilePath(filePath);
		},
		[scrollToDiffFile, updateSelectedFilePath],
	);

	const selectTurn = (turnId: TurnId) => {
		if (!activeThread) return;
		void navigate({
			to: "/$threadId",
			params: { threadId: activeThread.id },
			search: (previous) => {
				const rest = stripDiffSearchParams(previous);
				return { ...rest, diff: "1", diffTurnId: turnId };
			},
		});
	};
	const selectWholeConversation = () => {
		if (!activeThread) return;
		void navigate({
			to: "/$threadId",
			params: { threadId: activeThread.id },
			search: (previous) => {
				const rest = stripDiffSearchParams(previous);
				return { ...rest, diff: "1" };
			},
		});
	};
	const updateTurnStripScrollState = useCallback(() => {
		const element = turnStripRef.current;
		if (!element) {
			setCanScrollTurnStripLeft(false);
			setCanScrollTurnStripRight(false);
			return;
		}

		const maxScrollLeft = Math.max(
			0,
			element.scrollWidth - element.clientWidth,
		);
		setCanScrollTurnStripLeft(element.scrollLeft > 4);
		setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
	}, []);
	const scrollTurnStripBy = useCallback((offset: number) => {
		const element = turnStripRef.current;
		if (!element) return;
		element.scrollBy({ left: offset, behavior: "smooth" });
	}, []);
	const onTurnStripWheel = useCallback(
		(event: ReactWheelEvent<HTMLDivElement>) => {
			const element = turnStripRef.current;
			if (!element) return;
			if (element.scrollWidth <= element.clientWidth + 1) return;
			if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

			event.preventDefault();
			element.scrollBy({ left: event.deltaY, behavior: "auto" });
		},
		[],
	);

	useEffect(() => {
		const element = turnStripRef.current;
		if (!element) return;

		const frameId = window.requestAnimationFrame(() =>
			updateTurnStripScrollState(),
		);
		const onScroll = () => updateTurnStripScrollState();

		element.addEventListener("scroll", onScroll, { passive: true });

		const resizeObserver = new ResizeObserver(() =>
			updateTurnStripScrollState(),
		);
		resizeObserver.observe(element);

		return () => {
			window.cancelAnimationFrame(frameId);
			element.removeEventListener("scroll", onScroll);
			resizeObserver.disconnect();
		};
	}, [updateTurnStripScrollState]);

	useEffect(() => {
		const frameId = window.requestAnimationFrame(() =>
			updateTurnStripScrollState(),
		);
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [updateTurnStripScrollState]);

	useEffect(() => {
		const element = turnStripRef.current;
		if (!element) return;

		const selectedChip = element.querySelector<HTMLElement>(
			`[data-turn-chip-key="${CSS.escape(selectedTurn?.turnId ?? "__all__")}"]`,
		);
		selectedChip?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
			behavior: "smooth",
		});
	}, [selectedTurn]);

	const shouldUseDragRegion = isDesktopShell && mode !== "sheet";
	const selectionLabel = selectedTurn
		? `Turn ${
				selectedTurn.checkpointTurnCount ??
				inferredCheckpointTurnCountByTurnId[selectedTurn.turnId] ??
				"?"
			}`
		: "Conversation";
	const headerRow = (
		<>
			<div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
				{canScrollTurnStripLeft && (
					<div className="pointer-events-none absolute inset-y-0 left-8 z-10 w-7 bg-linear-to-r from-card to-transparent" />
				)}
				{canScrollTurnStripRight && (
					<div className="pointer-events-none absolute inset-y-0 right-8 z-10 w-7 bg-linear-to-l from-card to-transparent" />
				)}
				<button
					type="button"
					className={cn(
						"absolute left-0 top-1/2 z-20 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
						canScrollTurnStripLeft
							? "border-border/70 hover:border-border hover:text-foreground"
							: "cursor-not-allowed border-border/40 text-muted-foreground/40",
					)}
					onClick={() => scrollTurnStripBy(-180)}
					disabled={!canScrollTurnStripLeft}
					aria-label="Scroll turn list left"
				>
					<ChevronLeftIcon className="size-3" />
				</button>
				<button
					type="button"
					className={cn(
						"absolute right-0 top-1/2 z-20 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
						canScrollTurnStripRight
							? "border-border/70 hover:border-border hover:text-foreground"
							: "cursor-not-allowed border-border/40 text-muted-foreground/40",
					)}
					onClick={() => scrollTurnStripBy(180)}
					disabled={!canScrollTurnStripRight}
					aria-label="Scroll turn list right"
				>
					<ChevronRightIcon className="size-3" />
				</button>
				<div
					ref={turnStripRef}
					className="turn-chip-strip flex gap-1 overflow-x-auto px-7 py-0"
					onWheel={onTurnStripWheel}
				>
					<button
						type="button"
						className="shrink-0 rounded-md"
						onClick={selectWholeConversation}
						data-turn-chip-key="__all__"
						data-turn-chip-selected={selectedTurnId === null}
					>
						<div
							className={cn(
								"rounded-md border px-2 py-[3px] text-left transition-colors",
								selectedTurnId === null
									? "border-border bg-accent text-accent-foreground"
									: "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
							)}
						>
							<div className="text-[11px] leading-tight font-medium">
								All turns
							</div>
						</div>
					</button>
					{orderedTurnDiffSummaries.map((summary) => (
						<button
							key={summary.turnId}
							type="button"
							className="shrink-0 rounded-md"
							onClick={() => selectTurn(summary.turnId)}
							data-turn-chip-key={summary.turnId}
							title={summary.turnId}
							data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
						>
							<div
								className={cn(
									"rounded-md border px-2 py-[3px] text-left transition-colors",
									summary.turnId === selectedTurn?.turnId
										? "border-border bg-accent text-accent-foreground"
										: "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
								)}
							>
								<div className="flex items-center gap-1">
									<span className="text-[11px] leading-tight font-medium">
										Turn{" "}
										{summary.checkpointTurnCount ??
											inferredCheckpointTurnCountByTurnId[summary.turnId] ??
											"?"}
									</span>
									<span className="text-[10px] leading-tight opacity-70">
										{formatTurnChipTimestamp(summary.completedAt)}
									</span>
								</div>
							</div>
						</button>
					))}
				</div>
			</div>
			<ToggleGroup
				className="shrink-0 [-webkit-app-region:no-drag]"
				variant="outline"
				size="xs"
				value={[diffRenderMode]}
				onValueChange={(value) => {
					const next = value[0];
					if (next === "stacked" || next === "split") {
						setDiffRenderMode(next);
					}
				}}
			>
				<Toggle aria-label="Stacked diff view" value="stacked">
					<Rows3Icon className="size-3" />
				</Toggle>
				<Toggle
					aria-label="Split diff view"
					disabled={shouldForceStacked}
					value="split"
				>
					<Columns2Icon className="size-3" />
				</Toggle>
			</ToggleGroup>
		</>
	);
	const headerRowClassName = cn(
		"flex min-h-10 flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 md:px-3",
		shouldUseDragRegion ? "drag-region border-b border-border" : "",
	);

	return (
		<div
			ref={panelRef}
			style={diffSurfaceStyle}
			className={cn(
				"flex h-full min-w-0 flex-col bg-background",
				mode === "inline"
					? "w-[42vw] min-w-90 max-w-140 shrink-0 border-l border-border"
					: "w-full",
			)}
		>
			{shouldUseDragRegion ? (
				<div className={headerRowClassName}>{headerRow}</div>
			) : (
				<div className="border-b border-border">
					<div className={headerRowClassName}>{headerRow}</div>
				</div>
			)}

			{!activeThread ? (
				<div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
					Select a thread to inspect turn diffs.
				</div>
			) : !isGitRepo ? (
				<div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
					Turn diffs are unavailable because this project is not a git
					repository.
				</div>
			) : orderedTurnDiffSummaries.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
					No completed turns yet.
				</div>
			) : (
				<div
					ref={patchViewportRef}
					className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
				>
					{checkpointDiffError && !renderablePatch && (
						<div className="px-3 pt-3">
							<p className="mb-2 text-[11px] text-red-500/80">
								{checkpointDiffError}
							</p>
						</div>
					)}
					{!renderablePatch ? (
						<div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
							<p>
								{isLoadingCheckpointDiff
									? "Loading checkpoint diff..."
									: hasNoNetChanges
										? "No net changes in this selection."
										: "No patch available for this selection."}
							</p>
						</div>
					) : renderablePatch.kind === "files" ? (
						<div className="flex h-full min-h-0 flex-col gap-2 p-2">
							<div className="rounded-xl border border-border/70 bg-card/42 px-3 py-2">
								<div className="flex flex-col gap-2.5 xl:flex-row xl:items-start">
									<div className="min-w-0 flex-1">
										<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground/72">
											<span className="rounded-full border border-border/70 bg-background/75 px-2 py-0.5 font-medium text-foreground/88">
												{selectionLabel}
											</span>
											<span>
												{normalizedFileQuery.length > 0
													? `${visibleDiffFileItems.length} of ${diffFileItems.length} files`
													: `${diffFileItems.length} files`}
											</span>
											<span className="font-medium text-emerald-500/90">
												+{visibleFileStats.additions}
											</span>
											<span className="font-medium text-rose-500/90">
												-{visibleFileStats.deletions}
											</span>
											{forcedBehaviorHints.map((hint) => (
												<span
													key={hint}
													className="rounded-full border border-border/60 bg-background/55 px-2 py-0.5 text-2xs font-medium text-muted-foreground/88"
												>
													{hint}
												</span>
											))}
										</div>
										<div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-1.5">
											<div className="flex min-w-0 items-center gap-1.5">
												<Button
													aria-expanded={isFileSearchExpanded}
													aria-label={
														isFileSearchExpanded
															? "Focus changed files filter"
															: "Show changed files filter"
													}
													size="icon-xs"
													variant="outline"
													onClick={() =>
														setIsFileSearchExpanded((current) =>
															fileQuery.trim().length > 0 ? true : !current,
														)
													}
												>
													<SearchIcon className="size-3.5" />
												</Button>
												{(isFileSearchExpanded ||
													normalizedFileQuery.length > 0) && (
													<div className="min-w-0 max-w-72 flex-1 sm:flex-none">
														<div className="relative w-[min(18rem,calc(100vw-11rem))] max-w-full">
															<SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
															<Input
																autoFocus
																aria-label="Filter changed files"
																className="rounded-lg pl-8"
																nativeInput
																placeholder="Filter changed files"
																size="sm"
																type="search"
																value={fileQuery}
																onBlur={(event) => {
																	if (event.target.value.trim().length === 0) {
																		setIsFileSearchExpanded(false);
																	}
																}}
																onChange={(event) => {
																	const nextValue = event.target.value;
																	setFileQuery(nextValue);
																	if (nextValue.trim().length > 0) {
																		setIsFileSearchExpanded(true);
																	}
																}}
																onKeyDown={(event) => {
																	if (event.key !== "Escape") return;
																	setFileQuery("");
																	setIsFileSearchExpanded(false);
																	event.currentTarget.blur();
																}}
															/>
														</div>
													</div>
												)}
											</div>
											<div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/65 p-1">
												<Popover>
													<Tooltip>
														<PopoverTrigger
															className={cn(
																toggleVariants({
																	variant: "outline",
																	size: "xs",
																}),
															)}
															render={
																<TooltipTrigger
																	render={
																		<button
																			type="button"
																			aria-label="Adjust density"
																		/>
																	}
																/>
															}
														>
															<BetweenHorizontalStartIcon className="size-3" />
														</PopoverTrigger>
														<TooltipPopup side="top">
															Adjust density
														</TooltipPopup>
													</Tooltip>
													<PopoverPopup
														align="end"
														className="w-56 p-3 shadow-xl"
														side="bottom"
														sideOffset={8}
													>
														<div className="mb-3 flex items-center justify-between gap-2 text-2xs font-medium tracking-[0.12em] text-muted-foreground/68 uppercase">
															<span className="inline-flex items-center gap-1.5">
																<BetweenHorizontalStartIcon className="size-3" />
																Density
															</span>
															<span className="text-foreground/85 normal-case tracking-normal">
																{DIFF_SIZE_LABELS[settings.diffSize]}
															</span>
														</div>
														<input
															type="range"
															min={0}
															max={DIFF_SIZE_OPTIONS.length - 1}
															step={1}
															value={diffSizeSliderValue}
															onChange={(event) => {
																const next =
																	DIFF_SIZE_OPTION_BY_INDEX[
																		Number(event.target.value)
																	];
																if (next) {
																	updateUISettings({ diffSize: next });
																}
															}}
															className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
															aria-label="Diff density"
															aria-valuetext={
																DIFF_SIZE_LABELS[settings.diffSize]
															}
														/>
														<div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground/68">
															<span>Tight</span>
															<span>Balanced</span>
															<span>Large</span>
														</div>
													</PopoverPopup>
												</Popover>
												<Tooltip>
													<TooltipTrigger
														render={
															<Toggle
																aria-label="Toggle changed files navigator"
																pressed={settings.diffShowFileNavigator}
																size="xs"
																variant="outline"
																onPressedChange={(pressed) =>
																	updateUISettings({
																		diffShowFileNavigator: pressed,
																	})
																}
															>
																<ListTreeIcon className="size-3" />
															</Toggle>
														}
													/>
													<TooltipPopup side="top">
														{settings.diffShowFileNavigator
															? "Hide changed files navigator"
															: "Show changed files navigator"}
													</TooltipPopup>
												</Tooltip>
												<Tooltip>
													<TooltipTrigger
														render={
															<Toggle
																aria-label="Wrap long lines"
																disabled={shouldForceWrap}
																pressed={settings.diffWrap}
																size="xs"
																variant="outline"
																onPressedChange={(pressed) =>
																	updateUISettings({ diffWrap: pressed })
																}
															>
																<WrapTextIcon className="size-3" />
															</Toggle>
														}
													/>
													<TooltipPopup side="top">
														{shouldForceWrap
															? "Wrapping is enabled automatically on narrow panels."
															: settings.diffWrap
																? "Disable line wrapping"
																: "Wrap long lines"}
													</TooltipPopup>
												</Tooltip>
												<Tooltip>
													<TooltipTrigger
														render={
															<Toggle
																aria-label="Show line numbers"
																disabled={shouldForceHideLineNumbers}
																pressed={settings.diffShowLineNumbers}
																size="xs"
																variant="outline"
																onPressedChange={(pressed) =>
																	updateUISettings({
																		diffShowLineNumbers: pressed,
																	})
																}
															>
																<HashIcon className="size-3" />
															</Toggle>
														}
													/>
													<TooltipPopup side="top">
														{shouldForceHideLineNumbers
															? "Line numbers hide automatically on the smallest widths."
															: settings.diffShowLineNumbers
																? "Hide line numbers"
																: "Show line numbers"}
													</TooltipPopup>
												</Tooltip>
											</div>
										</div>
									</div>
								</div>
							</div>

							{showCompactNavigator && (
								<div className="overflow-hidden rounded-xl border border-border/70 bg-card/36">
									<div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
										<div className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground/68 uppercase">
											Changed files
										</div>
										<div className="text-2xs text-muted-foreground/68 tabular-nums">
											{visibleDiffFileItems.length}
										</div>
									</div>
									<div className="max-h-72 overflow-auto p-2">
										<div className="space-y-1.5">
											{visibleDiffFileItems.map((item) => (
												<DiffNavigatorFileButton
													key={item.path}
													item={item}
													selected={selectedFilePath === item.path}
													onSelect={selectDiffFile}
												/>
											))}
										</div>
									</div>
								</div>
							)}

							<div
								className={cn(
									"min-h-0 flex-1 overflow-hidden",
									showSidebarNavigator
										? "grid grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] gap-2"
										: "flex flex-col",
								)}
							>
								{showSidebarNavigator && (
									<aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/36">
										<div className="border-b border-border/70 px-3 py-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground/68 uppercase">
											Changed files
										</div>
										<div className="min-h-0 flex-1 overflow-auto p-2">
											<div className="space-y-1">
												{visibleDiffFileItems.map((item) => (
													<DiffNavigatorFileButton
														key={item.path}
														item={item}
														selected={selectedFilePath === item.path}
														onSelect={selectDiffFile}
														variant="sidebar"
													/>
												))}
											</div>
										</div>
									</aside>
								)}

								<div className="min-h-0 overflow-hidden rounded-xl border border-border/70 bg-background/55">
									{visibleRenderableFiles.length === 0 ? (
										<div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
											No changed files match this filter.
										</div>
									) : (
										<Virtualizer
											className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
											config={{
												intersectionObserverMargin: 1200,
												overscrollSize: 600,
											}}
										>
											{visibleRenderableFiles.map((fileDiff) => {
												const filePath = resolveFileDiffPath(fileDiff);
												const fileKey = buildFileDiffRenderKey(fileDiff);
												const themedFileKey = `${fileKey}:${resolvedTheme}`;
												return (
													<div
														key={themedFileKey}
														data-diff-file-path={filePath}
														className={cn(
															"diff-render-file mb-2 rounded-lg first:mt-2 last:mb-0",
															selectedFilePath === filePath &&
																"ring-1 ring-primary/40",
														)}
														onClickCapture={(event) => {
															const nativeEvent =
																event.nativeEvent as MouseEvent;
															const composedPath =
																nativeEvent.composedPath?.() ?? [];
															const clickedHeader = composedPath.some(
																(node) => {
																	if (!(node instanceof Element)) return false;
																	return node.hasAttribute("data-title");
																},
															);
															if (!clickedHeader) return;
															openDiffFileInEditor(filePath);
														}}
													>
														<FileDiff
															fileDiff={fileDiff}
															options={{
																diffStyle:
																	effectiveDiffRenderMode === "split"
																		? "split"
																		: "unified",
																disableLineNumbers: !effectiveShowLineNumbers,
																lineDiffType: "none",
																overflow: effectiveWrap ? "wrap" : "scroll",
																theme: resolveDiffThemeName(resolvedTheme),
																themeType: resolvedTheme as DiffThemeType,
																unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
															}}
														/>
													</div>
												);
											})}
										</Virtualizer>
									)}
								</div>
							</div>
						</div>
					) : (
						<div className="h-full overflow-auto p-2">
							<div className="space-y-2 rounded-xl border border-border/70 bg-card/36 p-3">
								<p className="text-[11px] text-muted-foreground/75">
									{renderablePatch.reason}
								</p>
								<pre className="max-h-[72vh] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
									{renderablePatch.text}
								</pre>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
