import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

type DivProps = ComponentPropsWithoutRef<"div">;

export function SettingsSection({
  title,
  description,
  className,
  children,
}: DivProps & {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "settings-density-card rounded-2xl border border-border bg-card shadow-xs/5",
        className,
      )}
    >
      <div className="mb-4 space-y-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsPanel({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-background/50 px-4 py-3", className)}
      {...props}
    />
  );
}

export function SettingsActions({ className, ...props }: DivProps) {
  return <div className={cn("mt-3 flex justify-end gap-2", className)} {...props} />;
}

export function SettingsHint({ className, ...props }: DivProps) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function SettingsEmptyState({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function SettingsResetButton({
  children = "Restore default",
  ...props
}: ComponentPropsWithoutRef<typeof Button>) {
  return (
    <Button size="xs" variant="outline" {...props}>
      {children}
    </Button>
  );
}

export function SettingsToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  ariaLabel,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <SettingsPanel
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <SettingsHint className="mt-1">{description}</SettingsHint> : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(Boolean(next))}
        aria-label={ariaLabel}
      />
    </SettingsPanel>
  );
}
