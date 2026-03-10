/**
 * DebouncedStorage - Wraps a Storage implementation and debounces setItem writes.
 *
 * Used to avoid blocking the main thread on every state change (e.g. composer
 * drafts with base64 images). getItem is synchronous; setItem is debounced;
 * removeItem cancels any pending setItem for that key then removes.
 * flush() writes any pending value immediately (e.g. beforeunload or before
 * a synchronous read that must see the latest write).
 */

const DEFAULT_DEBOUNCE_MS = 300;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DebouncedStorageOptions {
  debounceMs?: number;
}

export class DebouncedStorage implements StorageLike {
  private readonly underlying: StorageLike;
  private readonly debounceMs: number;
  private pendingKey: string | null = null;
  private pendingValue: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(underlying: StorageLike, options: DebouncedStorageOptions = {}) {
    this.underlying = underlying;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  getItem(key: string): string | null {
    return this.underlying.getItem(key);
  }

  setItem(key: string, value: string): void {
    if (this.pendingKey === key) {
      this.pendingValue = value;
      return;
    }
    this.flush();
    this.pendingKey = key;
    this.pendingValue = value;
    this.timer = setTimeout(() => {
      this.timer = null;
      const k = this.pendingKey;
      const v = this.pendingValue;
      this.pendingKey = null;
      this.pendingValue = null;
      if (k !== null && v !== null) {
        this.underlying.setItem(k, v);
      }
    }, this.debounceMs);
  }

  removeItem(key: string): void {
    if (this.pendingKey === key) {
      clearTimeout(this.timer ?? 0);
      this.timer = null;
      this.pendingKey = null;
      this.pendingValue = null;
    }
    this.underlying.removeItem(key);
  }

  /**
   * Writes any pending setItem immediately. Call before reading back from
   * storage (e.g. syncPersistedAttachments) or on beforeunload.
   */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingKey !== null && this.pendingValue !== null) {
      this.underlying.setItem(this.pendingKey, this.pendingValue);
      this.pendingKey = null;
      this.pendingValue = null;
    }
  }
}
