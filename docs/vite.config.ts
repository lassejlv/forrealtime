import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import fumadocsMdx from "fumadocs-mdx/vite";
import viteReact from "@vitejs/plugin-react";
import { docs } from "./source.config";
import { fileURLToPath } from "node:url";

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
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    fumadocsMdx({ docs }),
    tanstackStart(),
    viteReact(),
  ],
});
