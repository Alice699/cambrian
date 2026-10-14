import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const port = process.env.API_PORT || loadEnv(mode, projectRoot, "").API_PORT || "8787";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }
  return {
    server: {
      proxy: {
        // Same-origin API calls work even when Vite chooses another local port.
        "/api": {
          target: `http://127.0.0.1:${Number(port)}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ""),
        },
      },
    },
  };
});
