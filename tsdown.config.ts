import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "adapters/ioredis": "src/adapters/ioredis.ts",
    "adapters/bun": "src/adapters/bun.ts",
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
    neverBundle: ["ioredis", "react", "react-dom", "zod"],
  },
});
