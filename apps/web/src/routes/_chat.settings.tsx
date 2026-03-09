import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";
import { isDesktopShell } from "../env";
import { CustomModelsSection } from "./settings/-CustomModelsSection";
import { KeybindingsSection } from "./settings/-KeybindingsSection";
import {
	NotificationsSection,
	ResponsesSection,
} from "./settings/-NotificationsSection";
import { ProvidersSection } from "./settings/-ProvidersSection";
import { SafetySection } from "./settings/-SafetySection";
import {
	parseSettingsTab,
	SETTINGS_TABS,
	type SettingsTab,
} from "./settings/-settingsNavigation";
import { ThemeSection } from "./settings/-ThemeSection";

const SETTINGS_TAB_PANELS: Record<SettingsTab, ComponentType> = {
	appearance: ThemeSection,
	providers: ProvidersSection,
	models: CustomModelsSection,
	responses: ResponsesSection,
	notifications: NotificationsSection,
	keybindings: KeybindingsSection,
	safety: SafetySection,
};

function navigateBackFromSettings(
	navigate: ReturnType<typeof useNavigate>,
): void {
	if (typeof window !== "undefined" && window.history.length > 1) {
		window.history.back();
	} else {
		void navigate({ to: "/" });
	}
}

function SettingsTabButton({
	tab,
	selected,
	onSelect,
	mobile,
}: {
	tab: (typeof SETTINGS_TABS)[number];
	selected: boolean;
	onSelect: () => void;
	mobile?: boolean;
}) {
	const baseClassName = mobile
		? "whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
		: "w-full rounded-xl px-3 py-2.5 text-left transition-all duration-150";
	const selectedClassName = mobile
		? "bg-primary text-primary-foreground"
		: "bg-primary/10 text-foreground ring-1 ring-primary/50 shadow-primary/10 shadow-sm";
	const idleClassName = mobile
		? "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
		: "text-muted-foreground hover:bg-accent/70 hover:text-foreground";

	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={`${baseClassName} ${selected ? selectedClassName : idleClassName}`}
		>
			<div className="text-[12px] font-medium">{tab.label}</div>
			{mobile ? null : (
				<p className="mt-0.5 text-[11px] text-muted-foreground/80">
					{tab.description}
				</p>
			)}
		</button>
	);
}

function SettingsRouteView() {
	const navigate = useNavigate({ from: Route.fullPath });
	const { tab: activeTab } = Route.useSearch();
	const ActiveSection = SETTINGS_TAB_PANELS[activeTab];

	const goBack = useCallback(() => {
		navigateBackFromSettings(navigate);
	}, [navigate]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			navigateBackFromSettings(navigate);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [navigate]);

	return (
		<SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
				<div className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-border px-4 sm:px-5">
					{isDesktopShell ? (
						<div className="drag-region flex min-w-0 flex-1 items-center">
							<span className="text-xs font-medium tracking-wide text-muted-foreground/70">
								Settings
							</span>
						</div>
					) : (
						<div className="min-w-0 flex-1" />
					)}
					<div className="flex shrink-0 items-center gap-2">
						<SidebarTrigger className="size-7 shrink-0 md:hidden" />
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="gap-2 text-muted-foreground hover:text-foreground"
							onClick={goBack}
						>
							<ArrowLeftIcon className="size-3.5" />
							<span className="text-xs">Back</span>
						</Button>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
					<div className="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:flex-row lg:gap-6">
						<aside className="hidden w-64 shrink-0 lg:block">
							<nav
								className="sticky top-4 space-y-1 rounded-2xl border border-border bg-card/80 p-2 text-xs shadow-xs/5 backdrop-blur-sm"
								aria-label="Settings sections"
							>
								<p className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
									Settings
								</p>
								{SETTINGS_TABS.map((tab) => {
									return (
										<SettingsTabButton
											key={tab.id}
											tab={tab}
											selected={activeTab === tab.id}
											onSelect={() =>
												void navigate({
													search: (previous) => ({
														...previous,
														tab: tab.id,
													}),
												})
											}
										/>
									);
								})}
							</nav>
						</aside>

						<div className="min-w-0 flex-1 space-y-5">
							<header className="space-y-2">
								<h1 className="text-2xl font-semibold tracking-tight text-foreground">
									Settings
								</h1>
								<p className="text-sm text-muted-foreground">
									Configure app-level preferences for this device.
								</p>
								<nav
									className="mt-2 flex gap-1.5 overflow-x-auto pb-1 lg:hidden"
									aria-label="Settings sections"
								>
									{SETTINGS_TABS.map((tab) => {
										return (
											<SettingsTabButton
												key={tab.id}
												tab={tab}
												selected={activeTab === tab.id}
												onSelect={() =>
													void navigate({
														search: (previous) => ({
															...previous,
															tab: tab.id,
														}),
													})
												}
												mobile
											/>
										);
									})}
								</nav>
							</header>

							<div>
								<ActiveSection />
							</div>
						</div>
					</div>
				</div>
			</div>
		</SidebarInset>
	);
}

export const Route = createFileRoute("/_chat/settings")({
	validateSearch: (search) => ({
		tab: parseSettingsTab(search.tab),
	}),
	component: SettingsRouteView,
});
