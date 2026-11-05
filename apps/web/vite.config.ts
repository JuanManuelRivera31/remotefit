/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In development the API runs on :3001 (npm run dev); the browser only talks to Vite.
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
  test: { environment: "jsdom" },
});
