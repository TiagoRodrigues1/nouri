import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  root: "frontend",
  plugins: [
    stylex.vite({ useCSSLayers: true, dev: process.env.NODE_ENV === "development", runtimeInjection: false }),
    react(),
    // Only the dev server gets the token; the API adds it to the built page at request time.
    {
      name: "nouri-api-token",
      apply: "serve",
      transformIndexHtml: () => [{ tag: "meta", attrs: { name: "nouri-api-token", content: loadEnv(mode, process.cwd(), "").API_TOKEN ?? "" }, injectTo: "head" }],
    },
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./frontend/src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/v1": "http://localhost:3000",
      "/openapi.json": "http://localhost:3000",
    },
  },
  build: { outDir: "../web/dist", emptyOutDir: true },
}));
