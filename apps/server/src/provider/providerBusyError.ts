export class ProviderBusyError extends Error {
	readonly _tag = "ProviderBusyError" as const;
	constructor(readonly threadId: string) {
		super("Provider session is already running a turn");
		this.name = "ProviderBusyError";
	}
}
