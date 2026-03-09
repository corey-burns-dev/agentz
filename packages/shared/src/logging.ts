import fs from "node:fs";
import path from "node:path";

export interface RotatingFileSinkOptions {
	readonly filePath: string;
	readonly maxBytes: number;
	readonly maxFiles: number;
	readonly throwOnError?: boolean;
}

export class RotatingFileSink {
	private readonly filePath: string;
	private readonly maxBytes: number;
	private readonly maxFiles: number;
	private readonly throwOnError: boolean;
	private currentSize = 0;

	constructor(options: RotatingFileSinkOptions) {
		if (options.maxBytes < 1) {
			throw new Error(`maxBytes must be >= 1 (received ${options.maxBytes})`);
		}
		if (options.maxFiles < 1) {
			throw new Error(`maxFiles must be >= 1 (received ${options.maxFiles})`);
		}

		this.filePath = options.filePath;
		this.maxBytes = options.maxBytes;
		this.maxFiles = options.maxFiles;
		this.throwOnError = options.throwOnError ?? false;

		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		this.pruneOverflowBackups();
		this.currentSize = this.readCurrentSize();
	}

	write(chunk: string | Buffer): void {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		if (buffer.length === 0) return;

		try {
			if (
				this.currentSize > 0 &&
				this.currentSize + buffer.length > this.maxBytes
			) {
				this.rotate();
			}

			fs.appendFileSync(this.filePath, buffer);
			this.currentSize += buffer.length;

			if (this.currentSize > this.maxBytes) {
				this.rotate();
			}
		} catch {
			this.currentSize = this.readCurrentSize();
			if (this.throwOnError) {
				throw new Error(`Failed to write log chunk to ${this.filePath}`);
			}
		}
	}

	private rotate(): void {
		try {
			// force:true makes rmSync a no-op when the oldest backup doesn't exist yet.
			fs.rmSync(this.withSuffix(this.maxFiles), { force: true });

			for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
				try {
					fs.renameSync(this.withSuffix(index), this.withSuffix(index + 1));
				} catch (err) {
					// Skip gaps — earlier backups may not exist yet.
					if (
						!(
							typeof err === "object" &&
							err !== null &&
							"code" in err &&
							err.code === "ENOENT"
						)
					) {
						throw err;
					}
				}
			}

			// filePath always exists here: rotation is only triggered when currentSize > 0.
			fs.renameSync(this.filePath, this.withSuffix(1));
			this.currentSize = 0;
		} catch {
			this.currentSize = this.readCurrentSize();
			if (this.throwOnError) {
				throw new Error(`Failed to rotate log file ${this.filePath}`);
			}
		}
	}

	private pruneOverflowBackups(): void {
		try {
			const dir = path.dirname(this.filePath);
			const baseName = path.basename(this.filePath);
			for (const entry of fs.readdirSync(dir)) {
				if (!entry.startsWith(`${baseName}.`)) continue;
				const suffix = Number(entry.slice(baseName.length + 1));
				if (!Number.isInteger(suffix) || suffix <= this.maxFiles) continue;
				fs.rmSync(path.join(dir, entry), { force: true });
			}
		} catch {
			if (this.throwOnError) {
				throw new Error(`Failed to prune log backups for ${this.filePath}`);
			}
		}
	}

	private readCurrentSize(): number {
		try {
			return fs.statSync(this.filePath).size;
		} catch {
			return 0;
		}
	}

	private withSuffix(index: number): string {
		return `${this.filePath}.${index}`;
	}
}
