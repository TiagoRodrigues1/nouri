import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    // Tailwind's layers go first so StyleX outranks its reset. Without this the dev server declares StyleX's layers first and loses.
    stylex.vite({ useCSSLayers: { before: ["properties", "theme", "base", "components", "utilities"] }, dev: process.env.NODE_ENV === "development", runtimeInjection: false }),
    tailwindcss(),
    react(),
    // Only the dev server needs this; the API adds the publishable key to the built page at request time.
    {
      name: "nouri-clerk-publishable-key",
      apply: "serve",
      transformIndexHtml: () => [{ tag: "meta", attrs: { name: "nouri-clerk-publishable-key", content: loadEnv(mode, fileURLToPath(new URL("../", import.meta.url)), "").CLERK_PUBLISHABLE_KEY ?? "" }, injectTo: "head" }],
    },
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/v1": "http://localhost:3000",
      "/openapi.json": "http://localhost:3000",
      // Provider sign-in returns here; the API checks the state cookie and redirects back to /overview.
      "/oauth": "http://localhost:3000",
    },
  },
  build: {
    outDir: "../web/dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Libraries change less often than the app, so each gets its own long-lived chunk.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "tanstack", test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: "clerk", test: /node_modules[\\/]@clerk[\\/]/ },
            { name: "ui", test: /node_modules[\\/](@radix-ui|radix-ui|@floating-ui|react-remove-scroll|sonner|lucide-react|tailwind-merge)/ },
            { name: "zod", test: /node_modules[\\/]zod[\\/]/ },
            // Loaded only when someone scans, so it stays out of the vendor chunk every page needs.
            { name: "barcode", test: /node_modules[\\/](barcode-detector|zxing-wasm)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
}));
