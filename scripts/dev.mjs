import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function apiPort(value = "8787") {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export async function readApiHealth(url, signal) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.ok === true && body.network === "betanet"
      && typeof body.faucet?.configured === "boolean" ? body : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function waitForApi(url, { timeoutMs = 10_000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const health = await readApiHealth(url, signal);
    if (health) return health;
    await delay(100, undefined, { signal });
  }
  throw new Error("Cambrian API did not become ready. Check the API startup output above.");
}

export async function startDev(args = process.argv.slice(2)) {
  const envFile = resolve(projectRoot, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const port = apiPort(process.env.API_PORT || "8787");
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const children = new Set();
  const shutdown = new AbortController();
  let stopping = false;

  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    shutdown.abort();
    for (const child of children) child.kill();
  };
  process.once("SIGINT", () => stop(130));
  process.once("SIGTERM", () => stop(143));
  if (process.connected) process.once("disconnect", () => stop(0));

  const launch = (label, childArgs) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    children.add(child);
    child.once("error", () => {
      console.error(`[Cambrian dev] Could not start ${label}.`);
      stop(1);
    });
    child.once("exit", (code) => {
      children.delete(child);
      if (!stopping) stop(code ?? 1);
    });
  };

  try {
    let health = await readApiHealth(healthUrl, shutdown.signal);
    if (health) {
      console.log(`[Cambrian dev] Reusing the Cambrian API on port ${port}.`);
    } else {
      launch("API", ["--env-file-if-exists=.env", "--experimental-strip-types", "apps/api/src/server.ts"]);
      health = await waitForApi(healthUrl, { signal: shutdown.signal });
    }
    if (stopping) return;
    if (!health.faucet.configured) {
      console.warn("[Cambrian dev] API is ready; faucet is disabled until a payout provider and amount are configured.");
    }
    launch("frontend", [
      resolve(projectRoot, "node_modules/vite/bin/vite.js"),
      "apps/web", "--host", "127.0.0.1", ...args,
    ]);
  } catch (error) {
    if (!stopping) {
      console.error(`[Cambrian dev] ${error instanceof Error ? error.message : "Startup failed."}`);
      stop(1);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startDev();
}
