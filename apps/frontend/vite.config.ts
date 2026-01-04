import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared/types": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  server: {
    port: 5173,
  },
});
