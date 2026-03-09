import type { GitStatusResult, ProjectEntry } from "@agents/contracts";
import { useQuery } from "@tanstack/react-query";
import {
	ChevronRightIcon,
	ExternalLinkIcon,
	FileIcon,
	FolderIcon,
	FolderTreeIcon,
	GitBranchIcon,
	GitPullRequestIcon,
	PanelRightCloseIcon,
	RefreshCwIcon,
	SearchIcon,
	TriangleAlertIcon,
} from "lucide-react";
import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	gitBranchesQueryOptions,
	gitIssuesQueryOptions,
	gitStatusQueryOptions,
} from "~/lib/gitReactQuery";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
	preferredTerminalEditor,
	resolvePathLinkTarget,
} from "~/terminal-links";
import type { ProjectDockTab } from "../projectDockRouteSearch";
import {
	type PerProjectNotificationSettings,
	useProjectNotificationSettings,
} from "../projectNotificationSettings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";

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
	projectName?: string;
	workspaceCwd: string | null;
}

const FILE_TREE_FETCH_LIMIT = 5_000;
const ISSUE_FETCH_LIMIT = 20;

function compareTreeNodes(
	left: WorkspaceTreeNode,
	right: WorkspaceTreeNode,
): number {
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

function buildWorkspaceTree(
	entries: readonly ProjectEntry[],
): WorkspaceTreeNode[] {
	const nodeByPath = new Map<string, WorkspaceTreeNode>();
	const roots: WorkspaceTreeNode[] = [];

	const ensureNode = (
		path: string,
		kind: ProjectEntry["kind"],
	): WorkspaceTreeNode => {
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
		nodes: nodes
			.map(visit)
			.filter((node): node is WorkspaceTreeNode => node !== null),
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

function projectNotificationSummary(
	settings: PerProjectNotificationSettings,
): string {
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
					<p className="pt-1 font-medium text-sm">
						{gitStatus.workingTree.files.length}
					</p>
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
									className={cn(
										"border text-2xs",
										statusToneClasses(gitStatus.pr.state),
									)}
								>
									{gitStatus.pr.state}
								</Badge>
								<span className="text-xs text-muted-foreground">
									PR #{gitStatus.pr.number}
								</span>
							</div>
							<p className="pt-2 font-medium text-sm leading-snug">
								{gitStatus.pr.title}
							</p>
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
	projectName,
	workspaceCwd,
}: ProjectDockProps) {
	const [fileFilter, setFileFilter] = useState("");
	const [expandedDirectories, setExpandedDirectories] = useState<
		Record<string, boolean>
	>({});
	const shouldLoadGitData = activeTab === "git" && gitCwd !== null;
	const notificationProjectKey = workspaceCwd;
	const {
		settings: projectNotificationSettings,
		updateSettings: updateProjectNotificationSettings,
	} = useProjectNotificationSettings(notificationProjectKey);

	const { data: branchList = null } = useQuery(gitBranchesQueryOptions(gitCwd));
	const isRepo = gitCwd === null ? false : (branchList?.isRepo ?? true);
	const { data: gitStatus = null, error: gitStatusError } = useQuery(
		gitStatusQueryOptions(gitCwd),
	);
	const {
		data: issuesResult,
		error: issuesError,
		isFetching: isIssuesFetching,
		refetch: refetchIssues,
	} = useQuery(
		gitIssuesQueryOptions({
			cwd: gitCwd,
			enabled: shouldLoadGitData && branchList?.isRepo === true,
			limit: ISSUE_FETCH_LIMIT,
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
		if (
			Object.keys(expandedDirectories).length > 0 ||
			workspaceTree.length === 0
		) {
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

	const openExternal = useCallback((url: string) => {
		const api = readNativeApi();
		if (!api) {
			toastManager.add({
				type: "error",
				title: "Link opening is unavailable.",
			});
			return;
		}
		void api.shell.openExternal(url).catch((error) => {
			toastManager.add({
				type: "error",
				title: "Unable to open link",
				description:
					error instanceof Error ? error.message : "An error occurred.",
			});
		});
	}, []);

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
			void api.shell
				.openInEditor(targetPath, preferredTerminalEditor())
				.catch((error) => {
					toastManager.add({
						type: "error",
						title: "Unable to open file",
						description:
							error instanceof Error ? error.message : "An error occurred.",
					});
				});
		},
		[workspaceCwd],
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
		[
			expandedDirectories,
			isFilteringFiles,
			openWorkspaceEntry,
			toggleDirectory,
		],
	);

	return (
		<div className="flex h-full w-full shrink-0 flex-col border-l border-border/70 bg-card/60 text-foreground backdrop-blur-sm">
			<div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">
						{projectName ?? "Project"}
					</p>
					<p className="text-[11px] text-muted-foreground">Project dock</p>
				</div>
				<Button
					size="icon-xs"
					variant="ghost"
					onClick={onClose}
					aria-label="Close project dock"
					className="text-muted-foreground/60 hover:text-foreground/80"
				>
					<PanelRightCloseIcon className="size-3.5" />
				</Button>
			</div>

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
					Git + Issues
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
					<div className="space-y-4 p-3">
						<div>
							<p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
								Repository
							</p>
							<div className="pt-2">
								<GitSummaryCard
									gitStatus={gitStatus}
									gitStatusError={gitStatusError}
									isRepo={isRepo}
								/>
							</div>
						</div>

						{isRepo && notificationProjectKey ? (
							<div>
								<p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
									Notifications
								</p>
								<div className="mt-2 space-y-2">
									<div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
										<div className="min-w-0">
											<p className="truncate text-sm font-medium text-foreground">
												Per-project alerts
											</p>
											<p className="mt-0.5 text-xs text-muted-foreground">
												{projectNotificationSummary(
													projectNotificationSettings,
												)}
											</p>
										</div>
										<Button
											size="xs"
											variant={
												projectNotificationSettings.disabled
													? "outline"
													: "ghost"
											}
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
														projectNotificationSettings.notifyOnTurnComplete ===
														false,
												})
											}
											className={cn(
												"inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition",
												projectNotificationSettings.notifyOnTurnComplete !==
													false && !projectNotificationSettings.disabled
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
													notifyOnError:
														projectNotificationSettings.notifyOnError === false,
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
							</div>
						) : null}

						<div>
							<div className="flex items-center justify-between gap-3">
								<p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
									Issues
								</p>
								<Button
									size="icon-xs"
									variant="ghost"
									onClick={() => {
										void refetchIssues();
									}}
									disabled={!isRepo || isIssuesFetching}
									aria-label="Refresh issues"
								>
									<RefreshCwIcon
										className={cn(
											"size-3.5",
											isIssuesFetching && "animate-spin",
										)}
									/>
								</Button>
							</div>

							<div className="space-y-2 pt-2">
								{!isRepo ? (
									<div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
										GitHub issues are unavailable because this project is not a
										git repository.
									</div>
								) : issuesError ? (
									<div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-sm text-amber-800 dark:text-amber-200">
										<div className="flex items-start gap-2">
											<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
											<span>
												{issuesError instanceof Error
													? issuesError.message
													: "Could not load GitHub issues."}
											</span>
										</div>
									</div>
								) : issuesResult?.issues.length ? (
									issuesResult.issues.map((issue) => (
										<button
											key={issue.url}
											type="button"
											onClick={() => openExternal(issue.url)}
											className="flex w-full items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/70 p-3 text-left transition hover:border-border hover:bg-accent/40"
										>
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<Badge
														variant="outline"
														className={cn(
															"border text-2xs",
															statusToneClasses(issue.state),
														)}
													>
														{issue.state}
													</Badge>
													<span className="text-xs text-muted-foreground">
														#{issue.number}
													</span>
												</div>
												<p className="pt-2 text-sm font-medium leading-snug">
													{issue.title}
												</p>
												{issue.labels.length > 0 ? (
													<div className="flex flex-wrap gap-1 pt-2">
														{issue.labels.slice(0, 3).map((label) => (
															<Badge
																key={`${issue.number}:${label.name}`}
																variant="secondary"
																className="rounded-md px-1.5 py-0 text-2xs"
															>
																{label.name}
															</Badge>
														))}
													</div>
												) : null}
											</div>
											<ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
										</button>
									))
								) : (
									<div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground">
										{isIssuesFetching
											? "Loading issues..."
											: "No GitHub issues found for this repository."}
									</div>
								)}
							</div>
						</div>
					</div>
				) : (
					<div className="space-y-3 p-3">
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
							<span>
								{workspaceEntriesQuery.data?.entries.length ?? 0} entries
							</span>
							{workspaceEntriesQuery.data?.truncated ? (
								<span>
									Showing first {FILE_TREE_FETCH_LIMIT.toLocaleString()}
								</span>
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
					: "Use the dock to review repo status and jump to GitHub issues."}
			</div>
		</div>
	);
});

export default ProjectDock;
