import type { NativeApi } from "@agents/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createWsNativeApiMock = vi.fn<() => NativeApi>();

vi.mock("./wsNativeApi", () => ({
  createWsNativeApi: createWsNativeApiMock,
}));

function setTestWindow(value: Window & typeof globalThis): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  vi.resetModules();
  createWsNativeApiMock.mockReset();
  setTestWindow({} as Window & typeof globalThis);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("nativeApi", () => {
  it("does not create a websocket native api when disabled by env", async () => {
    vi.stubEnv("VITE_NATIVE_API_DISABLED", "1");

    const { readNativeApi } = await import("./nativeApi");

    expect(readNativeApi()).toBeUndefined();
    expect(createWsNativeApiMock).not.toHaveBeenCalled();
  });

  it("prefers the injected native api even when websocket mode is disabled", async () => {
    vi.stubEnv("VITE_NATIVE_API_DISABLED", "1");
    const injectedApi = {} as NativeApi;
    setTestWindow({
      nativeApi: injectedApi,
    } as Window & typeof globalThis);

    const { readNativeApi } = await import("./nativeApi");

    expect(readNativeApi()).toBe(injectedApi);
    expect(createWsNativeApiMock).not.toHaveBeenCalled();
  });

  it("creates the websocket native api when enabled", async () => {
    const wsApi = {} as NativeApi;
    createWsNativeApiMock.mockReturnValue(wsApi);

    const { readNativeApi } = await import("./nativeApi");

    expect(readNativeApi()).toBe(wsApi);
    expect(createWsNativeApiMock).toHaveBeenCalledTimes(1);
  });
});
