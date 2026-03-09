import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "~/lib/utils";

export type SettingsOption<T extends string> = {
	value: T;
	label: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
};

export function SettingsSegmentedControl<T extends string>({
	legend,
	value,
	onChange,
	options,
	className,
}: {
	legend: string;
	value: T;
	onChange: (value: T) => void;
	options: ReadonlyArray<SettingsOption<T>>;
	className?: string;
}) {
	const name = useId();

	return (
		<fieldset className="min-w-0 border-0 p-0">
			<legend className="sr-only">{legend}</legend>
			<div className={cn("grid gap-2 sm:grid-cols-3", className)}>
				{options.map((option) => (
					<label
						key={option.value}
						className={cn(
							"min-w-0",
							option.disabled && "cursor-not-allowed opacity-60",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
							className="peer sr-only"
							disabled={option.disabled}
						/>
						<span
							className={cn(
								"flex min-h-11 w-full cursor-pointer flex-col rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-checked:border-primary peer-checked:bg-primary/8 peer-checked:text-foreground hover:border-primary/35 hover:bg-accent/40",
								option.disabled &&
									"cursor-not-allowed hover:border-border hover:bg-background",
							)}
						>
							<span className="text-xs font-medium">{option.label}</span>
							{option.description ? (
								<span className="mt-1 text-xs text-muted-foreground">
									{option.description}
								</span>
							) : null}
						</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}

export function SettingsCardRadioGroup<T extends string>({
	legend,
	value,
	onChange,
	options,
	className,
	renderCard,
}: {
	legend: string;
	value: T;
	onChange: (value: T) => void;
	options: ReadonlyArray<SettingsOption<T>>;
	className?: string;
	renderCard: (option: SettingsOption<T>, selected: boolean) => ReactNode;
}) {
	const name = useId();

	return (
		<fieldset className="min-w-0 border-0 p-0">
			<legend className="sr-only">{legend}</legend>
			<div className={cn("grid gap-2 sm:grid-cols-4", className)}>
				{options.map((option) => {
					const selected = value === option.value;
					return (
						<label
							key={option.value}
							className={cn(
								"min-w-0",
								option.disabled && "cursor-not-allowed opacity-60",
							)}
						>
							<input
								type="radio"
								name={name}
								value={option.value}
								checked={selected}
								onChange={() => onChange(option.value)}
								className="peer sr-only"
								disabled={option.disabled}
							/>
							<span
								className={cn(
									"flex min-h-full cursor-pointer rounded-xl border border-border bg-background/35 p-2 text-left transition-all duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-checked:border-primary peer-checked:bg-primary/6 peer-checked:shadow-primary/12 peer-checked:shadow-sm hover:border-primary/35 hover:bg-accent/25",
									option.disabled &&
										"cursor-not-allowed hover:border-border hover:bg-background/35",
								)}
							>
								{renderCard(option, selected)}
							</span>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}
