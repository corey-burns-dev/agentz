import { useAppSettings } from "~/appSettings";
import {
  SettingsActions,
  SettingsResetButton,
  SettingsSection,
  SettingsToggleRow,
} from "~/components/settings/SettingsSection";

export function SafetySection() {
  const { settings, defaults, updateSettings } = useAppSettings();

  return (
    <SettingsSection
      title="Safety"
      description="Additional guardrails for destructive local actions."
    >
      <SettingsToggleRow
        title="Confirm thread deletion"
        description="Ask for confirmation before deleting a thread and its chat history."
        checked={settings.confirmThreadDelete}
        onCheckedChange={(checked) =>
          updateSettings({
            confirmThreadDelete: checked,
          })
        }
        ariaLabel="Confirm thread deletion"
      />

      {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
        <SettingsActions>
          <SettingsResetButton
            onClick={() =>
              updateSettings({
                confirmThreadDelete: defaults.confirmThreadDelete,
              })
            }
          />
        </SettingsActions>
      ) : null}
    </SettingsSection>
  );
}
