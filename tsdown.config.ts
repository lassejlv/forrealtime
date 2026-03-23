import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "client/svelte": "src/client/svelte.ts",
    "adapters/ioredis": "src/adapters/ioredis.ts",
    "adapters/bun": "src/adapters/bun.ts",
    "plugins/postgres-sync": "src/plugins/postgres-sync.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  platform: "neutral",
  shims: true,
  treeshake: true,
  exports: false,
  deps: {
    neverBundle: ["ioredis", "react", "react-dom", "svelte", "zod"],
  },
});
