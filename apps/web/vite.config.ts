/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The published site lives under a sub-path on GitHub Pages (/remotefit/); the workflow passes it as VITE_BASE.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  base: env["VITE_BASE"] ?? "/",
  plugins: [react(), tailwindcss()],
  // In development the API runs on :3001 (npm run dev); the browser only talks to Vite.
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
  test: { environment: "jsdom" },
});
