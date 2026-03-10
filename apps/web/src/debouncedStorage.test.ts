import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DebouncedStorage, type StorageLike } from "./debouncedStorage";

function createMockStorage(): StorageLike & {
  setItem: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe("DebouncedStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getItem delegates to underlying storage", () => {
    const underlying = createMockStorage();
    underlying.setItem("k", "v");
    const storage = new DebouncedStorage(underlying, { debounceMs: 100 });
    expect(storage.getItem("k")).toBe("v");
  });

  it("setItem debounces writes", () => {
    const underlying = createMockStorage();
    const storage = new DebouncedStorage(underlying, { debounceMs: 100 });
    storage.setItem("k", "v1");
    expect(underlying.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(underlying.setItem).toHaveBeenCalledTimes(1);
    expect(underlying.setItem).toHaveBeenCalledWith("k", "v1");
  });

  it("setItem for same key updates pending value", () => {
    const underlying = createMockStorage();
    const storage = new DebouncedStorage(underlying, { debounceMs: 100 });
    storage.setItem("k", "v1");
    storage.setItem("k", "v2");
    vi.advanceTimersByTime(100);
    expect(underlying.setItem).toHaveBeenCalledTimes(1);
    expect(underlying.setItem).toHaveBeenCalledWith("k", "v2");
  });

  it("removeItem cancels pending setItem for that key", () => {
    const underlying = createMockStorage();
    const storage = new DebouncedStorage(underlying, { debounceMs: 100 });
    storage.setItem("k", "v");
    storage.removeItem("k");
    vi.advanceTimersByTime(100);
    expect(underlying.setItem).not.toHaveBeenCalled();
    expect(storage.getItem("k")).toBeNull();
  });

  it("flush writes pending value immediately", () => {
    const underlying = createMockStorage();
    const storage = new DebouncedStorage(underlying, { debounceMs: 100 });
    storage.setItem("k", "v");
    storage.flush();
    expect(underlying.setItem).toHaveBeenCalledWith("k", "v");
    expect(storage.getItem("k")).toBe("v");
    vi.advanceTimersByTime(100);
    expect(underlying.setItem).toHaveBeenCalledTimes(1);
  });
});
