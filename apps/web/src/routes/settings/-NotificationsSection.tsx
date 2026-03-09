import { useAppSettings } from "~/appSettings";
import {
	SettingsActions,
	SettingsResetButton,
	SettingsSection,
	SettingsToggleRow,
} from "~/components/settings/SettingsSection";

export function ResponsesSection() {
	const { settings, defaults, updateSettings } = useAppSettings();

	return (
		<SettingsSection
			title="Responses"
			description="Control how assistant output is rendered during a turn."
		>
			<SettingsToggleRow
				title="Stream assistant messages"
				description="Show token-by-token output while a response is in progress."
				checked={settings.enableAssistantStreaming}
				onCheckedChange={(checked) =>
					updateSettings({
						enableAssistantStreaming: checked,
					})
				}
				ariaLabel="Stream assistant messages"
			/>

			{settings.enableAssistantStreaming !==
			defaults.enableAssistantStreaming ? (
				<SettingsActions>
					<SettingsResetButton
						onClick={() =>
							updateSettings({
								enableAssistantStreaming: defaults.enableAssistantStreaming,
							})
						}
					/>
				</SettingsActions>
			) : null}
		</SettingsSection>
	);
}

export function NotificationsSection() {
	const { settings, updateSettings } = useAppSettings();

	return (
		<SettingsSection
			title="Notifications & sounds"
			description="Control alerts when turns finish or fail. Global settings apply to all projects unless overridden from the project dock."
		>
			<div className="space-y-3">
				<SettingsToggleRow
					title="Desktop notifications"
					description="Show OS or browser notifications for important events like completed turns or errors while the app is open."
					checked={settings.enableDesktopNotifications}
					onCheckedChange={(checked) =>
						updateSettings({
							enableDesktopNotifications: checked,
						})
					}
					ariaLabel="Toggle desktop notifications"
				/>

				<div className="space-y-3 rounded-xl border border-border bg-background/50 px-4 py-3">
					<SettingsToggleRow
						title="Sound on assistant reply"
						description="Play a subtle sound when an assistant response finishes, even if you are viewing a different thread."
						checked={settings.playSoundOnAssistantReply}
						onCheckedChange={(checked) =>
							updateSettings({
								playSoundOnAssistantReply: checked,
							})
						}
						ariaLabel="Toggle reply sounds"
						className="border-0 bg-transparent px-0 py-0"
					/>

					<SettingsToggleRow
						title="Sound on errors"
						description="Play a distinct sound when a provider or tool call fails so you can catch issues quickly."
						checked={settings.playSoundOnError}
						onCheckedChange={(checked) =>
							updateSettings({
								playSoundOnError: checked,
							})
						}
						ariaLabel="Toggle error sounds"
						className="border-0 bg-transparent px-0 py-0"
					/>

					<SettingsToggleRow
						title="Mute while app is focused"
						description="Suppress notification sounds while this window is focused so you only hear alerts when you switch away."
						checked={settings.muteWhileWindowFocused}
						onCheckedChange={(checked) =>
							updateSettings({
								muteWhileWindowFocused: checked,
							})
						}
						ariaLabel="Toggle mute while focused"
						className="border-0 bg-transparent px-0 py-0"
					/>

					<p className="text-xs text-muted-foreground">
						Per-project overrides are available from the project dock under{" "}
						<span className="font-medium">Git + Issues</span>.
					</p>
				</div>
			</div>
		</SettingsSection>
	);
}
