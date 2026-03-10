/**
 * ProviderHealth - Provider readiness snapshot service.
 *
 * Owns startup-time provider health checks (install/auth reachability) and
 * exposes the cached results to transport layers.
 *
 * @module ProviderHealth
 */
import type { ServerProviderStatus } from "@agents/contracts";
import type { Effect } from "effect";
import { ServiceMap } from "effect";

export interface ProviderHealthShape {
  /**
   * Read provider health statuses (cached; may be placeholder until checks complete).
   */
  readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;

  /**
   * Register a callback to run when background health checks have completed.
   * Called immediately if already resolved.
   */
  readonly onReady: (cb: (statuses: ReadonlyArray<ServerProviderStatus>) => void) => void;
}

export class ProviderHealth extends ServiceMap.Service<ProviderHealth, ProviderHealthShape>()(
  "agents/provider/Services/ProviderHealth",
) {}
