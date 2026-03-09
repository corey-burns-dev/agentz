import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
	SettingsHint,
	SettingsPanel,
	SettingsSection,
} from "~/components/settings/SettingsSection";
import { Button } from "~/components/ui/button";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { preferredTerminalEditor } from "~/terminal-links";

export function KeybindingsSection() {
	const serverConfigQuery = useQuery(serverConfigQueryOptions());
	const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
	const [openKeybindingsError, setOpenKeybindingsError] = useState<
		string | null
	>(null);

	const keybindingsConfigPath =
		serverConfigQuery.data?.keybindingsConfigPath ?? null;

	const openKeybindingsFile = useCallback(() => {
		if (!keybindingsConfigPath) return;
		setOpenKeybindingsError(null);
		setIsOpeningKeybindings(true);
		const api = ensureNativeApi();
		void api.shell
			.openInEditor(keybindingsConfigPath, preferredTerminalEditor())
			.catch((error) => {
				setOpenKeybindingsError(
					error instanceof Error
						? error.message
						: "Unable to open keybindings file.",
				);
			})
			.finally(() => {
				setIsOpeningKeybindings(false);
			});
	}, [keybindingsConfigPath]);

	return (
		<SettingsSection
			title="Keybindings"
			description={
				<>
					Open the persisted <code>keybindings.json</code> file to edit advanced
					bindings directly.
				</>
			}
		>
			<div className="space-y-3">
				<SettingsPanel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium text-foreground">
							Config file path
						</p>
						<p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
							{keybindingsConfigPath ?? "Resolving keybindings path..."}
						</p>
					</div>
					<Button
						size="xs"
						variant="outline"
						disabled={!keybindingsConfigPath || isOpeningKeybindings}
						onClick={openKeybindingsFile}
					>
						{isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
					</Button>
				</SettingsPanel>

				<SettingsHint>Opens in your preferred editor selection.</SettingsHint>
				{openKeybindingsError ? (
					<p className="text-xs text-destructive">{openKeybindingsError}</p>
				) : null}
			</div>
		</SettingsSection>
	);
}
