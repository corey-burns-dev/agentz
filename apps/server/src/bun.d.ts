declare const Bun: {
  spawn(
    command: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      terminal?: {
        cols: number;
        rows: number;
        data: (terminal: unknown, data: Uint8Array) => void;
      };
    },
  ): Bun.Subprocess;
};
declare namespace Bun {
  interface Subprocess {
    readonly pid: number;
    readonly exited: Promise<number | null | undefined>;
    kill(signal?: string): void;
    readonly signalCode?: number;
    readonly terminal?: {
      write(data: string): void;
      resize(cols: number, rows: number): void;
    };
  }
}
