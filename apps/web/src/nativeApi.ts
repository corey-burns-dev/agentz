import type { NativeApi } from "@agents/contracts";

import { isNativeApiDisabledByEnv } from "./env";
import { createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  if (
    isNativeApiDisabledByEnv &&
    window.desktopBridge === undefined &&
    window.nativeApi === undefined
  ) {
    return undefined;
  }

  cachedApi = createWsNativeApi();
  return cachedApi;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}
