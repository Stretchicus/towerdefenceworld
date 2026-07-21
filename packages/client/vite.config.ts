import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3101",
        ws: true,
      },
      "/health": "http://localhost:3101",
    },
  },
  build: {
    outDir: "dist",
  },
});
