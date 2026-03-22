import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import fumadocsMdx from "fumadocs-mdx/vite";
import viteReact from "@vitejs/plugin-react";
import { docs } from "./source.config";
import { fileURLToPath } from "node:url";
import { nitro } from "nitro/vite";

const pathPolyfill = fileURLToPath(
  new URL("./src/path-polyfill.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "node:path": pathPolyfill,
      path: pathPolyfill,
    },
  },
  plugins: [
    tailwindcss(),
    fumadocsMdx({ docs }),
    nitro({ preset: "node-server" }),
    tanstackStart(),
    viteReact(),
  ],
});
