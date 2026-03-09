import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@agentz\/contracts$/,
				replacement: path.resolve(
					import.meta.dirname,
					"./packages/contracts/src/index.ts",
				),
			},
		],
	},
});
