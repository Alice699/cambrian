import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server, claimFaucet, FaucetApiError, savedFetch, calls;
const address = "taVQ0UdXh8EhJBw2blXvgVOITohZrLiOc_QB0T_ct0kY7E";
const healthy = { ok: true, network: "betanet", faucet: { configured: true, amount: "100" } };
const receipt = { status: "submitted", requestId: "offline-faucet-claim", address, amount: "100" };
const response = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../apps/web", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "silent",
  });
  ({ claimFaucet, FaucetApiError } = await server.ssrLoadModule("/src/faucet.ts"));
});
after(async () => { await server?.close(); });
beforeEach(() => { savedFetch = globalThis.fetch; calls = []; });
afterEach(() => { globalThis.fetch = savedFetch; });

test("faucet checks API readiness before one claim and does not turn acceptance into confirmation", async () => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return response(options.method === "GET" ? healthy : receipt, options.method === "GET" ? 200 : 202);
  };
  assert.deepEqual(await claimFaucet(address), receipt);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/health$/);
  assert.equal(calls[0].options.method, "GET");
  assert.match(calls[1].url, /\/faucet\/claim$/);
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), { address });
  assert.ok(calls[1].options.headers["idempotency-key"]);
});

test("a stopped API returning an empty 502 reports the actual problem without sending a claim", async () => {
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    return { ok: false, status: 502, json: async () => { throw new SyntaxError("Empty proxy response"); } };
  };
  await assert.rejects(claimFaucet(address), error => error instanceof FaucetApiError
    && error.code === "api-unavailable" && error.status === 502 && /npm run dev/.test(error.message));
  assert.deepEqual(calls, ["GET"]);
});

test("an unreachable API is a preflight failure, not an uncertain submitted payout", async () => {
  globalThis.fetch = async (_url, options) => { calls.push(options.method); throw new TypeError("fetch failed"); };
  await assert.rejects(claimFaucet(address), error => error.code === "api-unavailable" && error.status === 0);
  assert.deepEqual(calls, ["GET"]);
});

test("a production HTML fallback cannot masquerade as a working faucet API", async () => {
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    return { ok: true, status: 200, json: async () => { throw new SyntaxError("HTML fallback"); } };
  };
  await assert.rejects(claimFaucet(address), error => error.code === "api-unavailable");
  assert.deepEqual(calls, ["GET"]);
});

test("an unconfigured provider never receives a payout request", async () => {
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    return response({ ...healthy, faucet: { configured: false, amount: null } });
  };
  await assert.rejects(claimFaucet(address), error => error.code === "not-configured" && error.status === 503);
  assert.deepEqual(calls, ["GET"]);
});

test("faucet preflight rejects a health response from the wrong network", async () => {
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    return response({ ...healthy, network: "mainnet" });
  };
  await assert.rejects(claimFaucet(address), error => error.code === "api-unavailable");
  assert.deepEqual(calls, ["GET"]);
});

test("cancelling the readiness check does not start a claim", async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    controller.abort();
    return response(healthy);
  };
  await assert.rejects(claimFaucet(address, controller.signal), { name: "AbortError" });
  assert.deepEqual(calls, ["GET"]);
});

test("provider errors after a claim retain the uncertainty code for read-only reconciliation", async () => {
  globalThis.fetch = async (_url, options) => {
    calls.push(options.method);
    return options.method === "GET" ? response(healthy)
      : response({ error: "provider-error", message: "Provider response delayed." }, 503);
  };
  await assert.rejects(claimFaucet(address), error => error.code === "provider-error" && error.status === 503);
  assert.deepEqual(calls, ["GET", "POST"]);
});
