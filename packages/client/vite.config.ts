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
    // three.js alone is large; split it so the app chunk stays small
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
        },
      },
    },
  },
});
