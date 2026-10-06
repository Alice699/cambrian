import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      // Same-origin API calls work even when Vite chooses another local port.
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ""),
      },
    },
  },
});
