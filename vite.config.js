import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.SERVER_PORT || "8787";

export default defineConfig({
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "icons";
          }
          return undefined;
        },
      },
    },
  },
  plugins: [react()],
});
