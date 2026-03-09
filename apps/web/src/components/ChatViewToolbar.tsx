import type {
	EditorId,
	ProjectScript,
	ResolvedKeybindingsConfig,
	ServerProviderStatus,
	ThreadId,
} from "@agentz/contracts";
import { EDITORS } from "@agentz/contracts";
import {
	ChevronDownIcon,
	CircleAlertIcon,
	DiffIcon,
	FolderClosedIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
	isOpenFavoriteEditorShortcut,
	shortcutLabelForCommand,
} from "../keybindings";
import { isMacPlatform, isWindowsPlatform } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { type deriveActivePlanState, formatTimestamp } from "../session-logic";
import GitActionsControl from "./GitActionsControl";
import { CursorIcon, type Icon, VisualStudioCode, Zed } from "./Icons";
import ProjectScriptsControl, {
	type NewProjectScriptInput,
} from "./ProjectScriptsControl";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Group, GroupSeparator } from "./ui/group";
import {
	Menu,
	MenuItem,
	MenuPopup,
	MenuShortcut,
	MenuTrigger,
} from "./ui/menu";
import { SidebarTrigger } from "./ui/sidebar";
import { Toggle } from "./ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const LAST_EDITOR_KEY = "agentz:last-editor";

interface ChatHeaderProps {
	activeThreadId: ThreadId;
	activeThreadTitle: string;
	activeProjectName: string | undefined;
	isGitRepo: boolean;
	openInCwd: string | null;
	activeProjectScripts: ProjectScript[] | undefined;
	preferredScriptId: string | null;
	keybindings: ResolvedKeybindingsConfig;
	availableEditors: ReadonlyArray<EditorId>;
	diffToggleShortcutLabel: string | null;
	gitCwd: string | null;
	diffOpen: boolean;
	onRunProjectScript: (script: ProjectScript) => void;
	onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
	onUpdateProjectScript: (
		scriptId: string,
		input: NewProjectScriptInput,
	) => Promise<void>;
	onToggleDiff: () => void;
}

const ChatHeader = memo(function ChatHeader({
	activeThreadId,
	activeThreadTitle,
	activeProjectName,
	isGitRepo,
	openInCwd,
	activeProjectScripts,
	preferredScriptId,
	keybindings,
	availableEditors,
	diffToggleShortcutLabel,
	gitCwd,
	diffOpen,
	onRunProjectScript,
	onAddProjectScript,
	onUpdateProjectScript,
	onToggleDiff,
}: ChatHeaderProps) {
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
				<SidebarTrigger className="size-7 shrink-0 md:hidden" />
				<h2
					className="min-w-0 shrink truncate text-sm font-medium text-foreground"
					title={activeThreadTitle}
				>
					{activeThreadTitle}
				</h2>
				{activeProjectName && (
					<Badge variant="outline" className="max-w-28 shrink-0 truncate">
						{activeProjectName}
					</Badge>
				)}
				{activeProjectName && !isGitRepo && (
					<Badge
						variant="outline"
						className="shrink-0 text-[10px] text-amber-700"
					>
						No Git
					</Badge>
				)}
			</div>
			<div className="@container/header-actions flex min-w-0 flex-1 items-center justify-end gap-2 @sm/header-actions:gap-3">
				{activeProjectScripts && (
					<ProjectScriptsControl
						scripts={activeProjectScripts}
						keybindings={keybindings}
						preferredScriptId={preferredScriptId}
						onRunScript={onRunProjectScript}
						onAddScript={onAddProjectScript}
						onUpdateScript={onUpdateProjectScript}
					/>
				)}
				{activeProjectName && (
					<OpenInPicker
						keybindings={keybindings}
						availableEditors={availableEditors}
						openInCwd={openInCwd}
					/>
				)}
				{activeProjectName && (
					<GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
				)}
				<Tooltip>
					<TooltipTrigger
						render={
							<Toggle
								className="shrink-0"
								pressed={diffOpen}
								onPressedChange={onToggleDiff}
								aria-label="Toggle diff panel"
								variant="outline"
								size="xs"
								disabled={!isGitRepo}
							>
								<DiffIcon className="size-3" />
							</Toggle>
						}
					/>
					<TooltipPopup side="bottom">
						{!isGitRepo
							? "Diff panel is unavailable because this project is not a git repository."
							: diffToggleShortcutLabel
								? `Toggle diff panel (${diffToggleShortcutLabel})`
								: "Toggle diff panel"}
					</TooltipPopup>
				</Tooltip>
			</div>
		</div>
	);
});

const ThreadErrorBanner = memo(function ThreadErrorBanner({
	error,
}: {
	error: string | null;
}) {
	if (!error) return null;
	return (
		<div className="pt-3 mx-auto max-w-3xl">
			<Alert variant="error">
				<CircleAlertIcon />
				<AlertDescription className="line-clamp-3" title={error}>
					{error}
				</AlertDescription>
			</Alert>
		</div>
	);
});

const ProviderHealthBanner = memo(function ProviderHealthBanner({
	status,
}: {
	status: ServerProviderStatus | null;
}) {
	if (!status || status.status === "ready") {
		return null;
	}

	const defaultMessage =
		status.status === "error"
			? `${status.provider} provider is unavailable.`
			: `${status.provider} provider has limited availability.`;

	return (
		<div className="pt-3 mx-auto max-w-3xl">
			<Alert variant={status.status === "error" ? "error" : "warning"}>
				<CircleAlertIcon />
				<AlertTitle>
					{status.provider === "codex"
						? "Codex provider status"
						: `${status.provider} status`}
				</AlertTitle>
				<AlertDescription
					className="line-clamp-3"
					title={status.message ?? defaultMessage}
				>
					{status.message ?? defaultMessage}
				</AlertDescription>
			</Alert>
		</div>
	);
});

const PlanModePanel = memo(function PlanModePanel({
	activePlan,
}: {
	activePlan: ReturnType<typeof deriveActivePlanState>;
}) {
	if (!activePlan) return null;

	return (
		<div className="pt-3 mx-auto max-w-3xl">
			<div className="rounded-xl border border-border/70 bg-muted/30 p-4">
				<div className="flex items-center gap-2">
					<Badge variant="secondary">Plan</Badge>
					<span className="text-xs text-muted-foreground">
						Updated {formatTimestamp(activePlan.createdAt)}
					</span>
				</div>
				{activePlan.explanation ? (
					<p className="mt-2 text-sm text-muted-foreground">
						{activePlan.explanation}
					</p>
				) : null}
				<div className="mt-3 space-y-2">
					{activePlan.steps.map((step) => (
						<div
							key={`${step.status}:${step.step}`}
							className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
						>
							<Badge
								variant={
									step.status === "completed"
										? "default"
										: step.status === "inProgress"
											? "secondary"
											: "outline"
								}
							>
								{step.status === "inProgress"
									? "In progress"
									: step.status === "completed"
										? "Done"
										: "Pending"}
							</Badge>
							<div className="min-w-0 flex-1 text-sm">{step.step}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
});

const OpenInPicker = memo(function OpenInPicker({
	keybindings,
	availableEditors,
	openInCwd,
}: {
	keybindings: ResolvedKeybindingsConfig;
	availableEditors: ReadonlyArray<EditorId>;
	openInCwd: string | null;
}) {
	const [lastEditor, setLastEditor] = useState<EditorId>(() => {
		const stored = localStorage.getItem(LAST_EDITOR_KEY);
		return EDITORS.some((editor) => editor.id === stored)
			? (stored as EditorId)
			: EDITORS[0].id;
	});

	const allOptions = useMemo<
		Array<{ label: string; Icon: Icon; value: EditorId }>
	>(
		() => [
			{ label: "Cursor", Icon: CursorIcon, value: "cursor" },
			{ label: "VS Code", Icon: VisualStudioCode, value: "vscode" },
			{ label: "Zed", Icon: Zed, value: "zed" },
			{
				label: isMacPlatform(navigator.platform)
					? "Finder"
					: isWindowsPlatform(navigator.platform)
						? "Explorer"
						: "Files",
				Icon: FolderClosedIcon,
				value: "file-manager",
			},
		],
		[],
	);
	const options = useMemo(
		() =>
			allOptions.filter((option) => availableEditors.includes(option.value)),
		[allOptions, availableEditors],
	);

	const effectiveEditor = options.some((option) => option.value === lastEditor)
		? lastEditor
		: (options[0]?.value ?? null);
	const primaryOption =
		options.find(({ value }) => value === effectiveEditor) ?? null;

	const openInEditor = useCallback(
		(editorId: EditorId | null) => {
			const api = readNativeApi();
			if (!api || !openInCwd) return;
			const editor = editorId ?? effectiveEditor;
			if (!editor) return;
			void api.shell.openInEditor(openInCwd, editor);
			localStorage.setItem(LAST_EDITOR_KEY, editor);
			setLastEditor(editor);
		},
		[effectiveEditor, openInCwd],
	);

	const openFavoriteEditorShortcutLabel = useMemo(
		() => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
		[keybindings],
	);

	useEffect(() => {
		const handler = (event: globalThis.KeyboardEvent) => {
			const api = readNativeApi();
			if (!isOpenFavoriteEditorShortcut(event, keybindings)) return;
			if (!api || !openInCwd) return;
			if (!effectiveEditor) return;

			event.preventDefault();
			void api.shell.openInEditor(openInCwd, effectiveEditor);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [effectiveEditor, keybindings, openInCwd]);

	return (
		<Group aria-label="Subscription actions">
			<Button
				size="xs"
				variant="outline"
				disabled={!effectiveEditor || !openInCwd}
				onClick={() => openInEditor(effectiveEditor)}
			>
				{primaryOption?.Icon && (
					<primaryOption.Icon aria-hidden="true" className="size-3.5" />
				)}
				<span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
					Open
				</span>
			</Button>
			<GroupSeparator className="hidden @sm/header-actions:block" />
			<Menu>
				<MenuTrigger
					render={
						<Button
							aria-label="Copy options"
							size="icon-xs"
							variant="outline"
						/>
					}
				>
					<ChevronDownIcon aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuPopup align="end">
					{options.length === 0 && (
						<MenuItem disabled>No installed editors found</MenuItem>
					)}
					{options.map(({ label, Icon, value }) => (
						<MenuItem key={value} onClick={() => openInEditor(value)}>
							<Icon aria-hidden="true" className="text-muted-foreground" />
							{label}
							{value === effectiveEditor && openFavoriteEditorShortcutLabel && (
								<MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
							)}
						</MenuItem>
					))}
				</MenuPopup>
			</Menu>
		</Group>
	);
});

export interface ToolbarProps extends ChatHeaderProps {
	isDesktopShell: boolean;
	providerStatus: ServerProviderStatus | null;
	threadError: string | null;
	activePlan: ReturnType<typeof deriveActivePlanState>;
}

export function Toolbar(props: ToolbarProps) {
	return (
		<>
			<header
				className={
					props.isDesktopShell
						? "drag-region flex h-13 items-center border-b border-border px-3 sm:px-5"
						: "border-b border-border px-3 py-2 sm:px-5 sm:py-3"
				}
			>
				<ChatHeader
					activeThreadId={props.activeThreadId}
					activeThreadTitle={props.activeThreadTitle}
					activeProjectName={props.activeProjectName}
					isGitRepo={props.isGitRepo}
					openInCwd={props.openInCwd}
					activeProjectScripts={props.activeProjectScripts}
					preferredScriptId={props.preferredScriptId}
					keybindings={props.keybindings}
					availableEditors={props.availableEditors}
					diffToggleShortcutLabel={props.diffToggleShortcutLabel}
					gitCwd={props.gitCwd}
					diffOpen={props.diffOpen}
					onRunProjectScript={props.onRunProjectScript}
					onAddProjectScript={props.onAddProjectScript}
					onUpdateProjectScript={props.onUpdateProjectScript}
					onToggleDiff={props.onToggleDiff}
				/>
			</header>
			<ProviderHealthBanner status={props.providerStatus} />
			<ThreadErrorBanner error={props.threadError} />
			<PlanModePanel activePlan={props.activePlan} />
		</>
	);
}
