import type { ReactNode } from "react";
import { useAppSettings } from "~/appSettings";
import {
  SettingsPanel,
  SettingsResetButton,
  SettingsSection,
} from "~/components/settings/SettingsSection";
import { Input } from "~/components/ui/input";

const PROVIDER_SETTINGS = [
  {
    title: "Codex App Server",
    binaryKey: "codexBinaryPath",
    binaryLabel: "Codex binary path",
    binaryPlaceholder: "codex",
    binaryHint: (
      <>
        Leave blank to use <code>codex</code> from your PATH.
      </>
    ),
    homeKey: "codexHomePath",
    homeLabel: "CODEX_HOME path",
    homePlaceholder: "/Users/you/.codex",
    homeHint: "Optional custom Codex home/config directory.",
    resetLabel: "Reset Codex overrides",
  },
  {
    title: "Gemini App Server",
    binaryKey: "geminiBinaryPath",
    binaryLabel: "Gemini binary path",
    binaryPlaceholder: "gemini",
    binaryHint: (
      <>
        Leave blank to use <code>gemini</code> from your PATH.
      </>
    ),
    homeKey: "geminiHomePath",
    homeLabel: "GEMINI_HOME path",
    homePlaceholder: "/Users/you/.gemini",
    homeHint: "Optional custom Gemini home/config directory.",
    resetLabel: "Reset Gemini overrides",
  },
  {
    title: "Claude Code",
    binaryKey: "claudeCodeBinaryPath",
    binaryLabel: "Claude binary path",
    binaryPlaceholder: "claude",
    binaryHint: (
      <>
        Leave blank to use <code>claude</code> from your PATH.
      </>
    ),
    homeKey: "claudeCodeHomePath",
    homeLabel: "CLAUDE_CONFIG_DIR path",
    homePlaceholder: "/Users/you/.claude",
    homeHint: "Optional custom Claude config directory.",
    resetLabel: "Reset Claude overrides",
  },
] as const;

type ProvidersSettings = ReturnType<typeof useAppSettings>["settings"];

function ProviderPathField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: ReactNode;
}) {
  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

export function ProvidersSection() {
  const { settings, defaults, updateSettings } = useAppSettings();

  return (
    <SettingsSection
      title="Providers"
      description="Override provider binaries and home directories for this device."
    >
      <div className="space-y-6">
        {PROVIDER_SETTINGS.map((provider) => {
          const binaryValue = settings[provider.binaryKey];
          const homeValue = settings[provider.homeKey];
          return (
            <SettingsPanel key={provider.title} className="space-y-4 rounded-2xl bg-background/40">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {provider.title}
              </h3>

              <ProviderPathField
                id={`${provider.binaryKey}-input`}
                label={provider.binaryLabel}
                value={binaryValue}
                onChange={(value) =>
                  updateSettings({
                    [provider.binaryKey]: value,
                  } as Partial<ProvidersSettings>)
                }
                placeholder={provider.binaryPlaceholder}
                hint={provider.binaryHint}
              />

              <ProviderPathField
                id={`${provider.homeKey}-input`}
                label={provider.homeLabel}
                value={homeValue}
                onChange={(value) =>
                  updateSettings({
                    [provider.homeKey]: value,
                  } as Partial<ProvidersSettings>)
                }
                placeholder={provider.homePlaceholder}
                hint={provider.homeHint}
              />

              <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Binary source:{" "}
                  <span className="font-medium text-foreground">{binaryValue || "PATH"}</span>
                </p>
                <SettingsResetButton
                  onClick={() =>
                    updateSettings({
                      [provider.binaryKey]: defaults[provider.binaryKey],
                      [provider.homeKey]: defaults[provider.homeKey],
                    } as Partial<ProvidersSettings>)
                  }
                >
                  {provider.resetLabel}
                </SettingsResetButton>
              </div>
            </SettingsPanel>
          );
        })}
      </div>
    </SettingsSection>
  );
}
