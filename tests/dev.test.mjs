import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { test } from "node:test";
import { apiPort, readApiHealth, waitForApi } from "../scripts/dev.mjs";

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/health`;
}

test("dev startup validates the API port without shell interpolation", () => {
  assert.equal(apiPort(), 8787);
  assert.equal(apiPort("9001"), 9001);
  for (const value of ["0", "65536", "1.5", "8787;echo", "", "not-a-port"]) {
    assert.throws(() => apiPort(value), /API_PORT/);
  }
});

test("dev startup recognizes an existing Cambrian API using a read-only health check", async t => {
  const requests = [];
  const url = await serve(t, (request, response) => {
    requests.push([request.method, request.url]);
    response.end(JSON.stringify({ ok: true, network: "betanet", faucet: { configured: true, amount: "100" } }));
  });
  assert.equal((await readApiHealth(url)).faucet.configured, true);
  assert.deepEqual(requests, [["GET", "/health"]]);
});

test("a disabled provider is still a running API, not a reason to launch a duplicate", async t => {
  const url = await serve(t, (_request, response) => {
    response.end(JSON.stringify({ ok: true, network: "betanet", faucet: { configured: false, amount: null } }));
  });
  assert.equal((await readApiHealth(url)).faucet.configured, false);
});

test("dev startup does not reuse an unrelated HTTP service", async t => {
  const url = await serve(t, (_request, response) => response.end('<html>not the API</html>'));
  assert.equal(await readApiHealth(url), null);
});

test("dev startup waits for API readiness before starting the frontend", async t => {
  let checks = 0;
  const url = await serve(t, (_request, response) => {
    checks++;
    response.statusCode = checks < 3 ? 503 : 200;
    response.end(JSON.stringify({ ok: true, network: "betanet", faucet: { configured: true } }));
  });
  assert.equal((await waitForApi(url, { timeoutMs: 2_000 })).ok, true);
  assert.equal(checks, 3);
});

test("dev startup fails clearly when the API cannot become ready", async t => {
  const url = await serve(t, (_request, response) => { response.statusCode = 502; response.end(); });
  await assert.rejects(waitForApi(url, { timeoutMs: 150 }), /API did not become ready/);
});

test("dev readiness checks can be cancelled without a faucet claim", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForApi("http://127.0.0.1:1/health", { signal: controller.signal }), { name: "AbortError" });
});

async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("the real dev launcher starts both services and proxies health on a custom API port", { timeout: 20_000 }, async () => {
  const port = await unusedPort();
  let webPort = await unusedPort();
  while (webPort === port) webPort = await unusedPort();
  const child = fork(fileURLToPath(new URL("../scripts/dev.mjs", import.meta.url)), ["--port", String(webPort), "--strictPort"], {
    env: { ...process.env, API_PORT: String(port), FAUCET_CLI_ENABLED: "false", FAUCET_PROVIDER_URL: "", FAUCET_AMOUNT_UNITS: "" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  // Never print inherited environment or provider output from this isolated smoke test.
  child.stdout.resume();
  child.stderr.resume();
  const exited = once(child, "exit");
  try {
    const api = await waitForApi(`http://127.0.0.1:${port}/health`);
    const proxy = await waitForApi(`http://127.0.0.1:${webPort}/api/health`);
    assert.equal(api.faucet.configured, false);
    assert.deepEqual(proxy, api);
    assert.equal((await fetch(`http://127.0.0.1:${webPort}/app`)).status, 200);
  } finally {
    if (child.connected) child.disconnect();
    await exited;
  }
  assert.equal(child.exitCode, 0);
  assert.equal(await readApiHealth(`http://127.0.0.1:${port}/health`), null);
  assert.equal(await readApiHealth(`http://127.0.0.1:${webPort}/api/health`), null);
});
