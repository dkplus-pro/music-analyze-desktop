import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiTarget = process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget
    }
  },
  test: {
    environment: "jsdom"
  }
});
