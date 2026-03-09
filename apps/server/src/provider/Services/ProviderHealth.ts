/**
 * ProviderHealth - Provider readiness snapshot service.
 *
 * Owns startup-time provider health checks (install/auth reachability) and
 * exposes the cached results to transport layers.
 *
 * @module ProviderHealth
 */
import type { ServerProviderStatus } from "@agentz/contracts";
import type { Effect } from "effect";
import { ServiceMap } from "effect";

export interface ProviderHealthShape {
	/**
	 * Read provider health statuses computed at server startup.
	 */
	readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;
}

export class ProviderHealth extends ServiceMap.Service<
	ProviderHealth,
	ProviderHealthShape
>()("agentz/provider/Services/ProviderHealth") {}
