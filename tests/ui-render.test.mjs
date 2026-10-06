import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

// Render real React components, without a browser, passkey, or network writes.
let server, components, app;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../apps/web", import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "silent" });
  components = await server.ssrLoadModule("/src/components/TransactionFeedback.tsx");
  app = await server.ssrLoadModule("/src/App.tsx");
});
after(async () => { await server?.close(); });

const renderBirth = (stage, extra = {}) => renderToStaticMarkup(createElement(components.BirthStatus, { account: "account-A", update: { stage, ...extra } }));

test("pending Birth render keeps the yellow state, status link, and four real steps", () => {
  const html = renderBirth("submitted", { signature: "public-signature" });
  assert.match(html, /birth-progress is-pending/);
  assert.match(html, /Waiting for confirmation/);
  assert.match(html, /View transaction/);
  assert.equal((html.match(/class="is-complete"/g) ?? []).length, 2);
  assert.match(html, /aria-current="step"/);
});
test("confirmed but unreadable Birth stays yellow, never a success toast", () => {
  const html = renderBirth("syncing");
  assert.match(html, /birth-progress is-pending/);
  assert.match(html, /syncing your organism/);
  assert.equal((html.match(/class="is-complete"/g) ?? []).length, 3);
});
test("completed Birth render is green with all four steps complete", () => {
  const html = renderBirth("confirmed");
  assert.match(html, /birth-progress is-success/);
  assert.equal((html.match(/class="is-complete"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /aria-current="step"/);
});
test("failed Birth render is red, announces the error, and retains explorer evidence", () => {
  const html = renderBirth("failed", { signature: "public-signature", error: new Error("VM execution failed") });
  assert.match(html, /birth-progress is-error/);
  assert.match(html, /role="alert"/);
  assert.match(html, /VM execution failed/);
  assert.match(html, /View transaction/);
});
test("success, pending, and failure notifications render with accessible non-color cues", () => {
  for (const tone of ["success", "pending", "error"]) {
    const html = renderToStaticMarkup(createElement(components.TransactionNotice, { tone, message: "Test transaction status" }));
    assert.match(html, new RegExp(`notice is-${tone}`));
    assert.match(html, /Dismiss notification/);
    assert.match(html, /aria-live=/);
    assert.match(html, /Test transaction status/);
  }
});
test("loading and empty renders remain different; errors offer a read-only retry", () => {
  const loading = renderToStaticMarkup(createElement(app.ReadStateCard, { title: "Loading", description: "Reading state", loading: true }));
  const empty = renderToStaticMarkup(createElement(app.ReadStateCard, { title: "Your collection starts here", description: "No organisms yet" }));
  const error = renderToStaticMarkup(createElement(app.ReadStateCard, { title: "Read failed", description: "RPC unavailable", tone: "error", onRetry: () => {} }));
  assert.match(loading, /aria-busy="true"/); assert.match(loading, /skeleton/);
  assert.match(empty, /aria-busy="false"/); assert.doesNotMatch(empty, /skeleton/);
  assert.match(error, /Retry read/); assert.match(error, /role="alert"/);
});

test("an unverified faucet claim retains a yellow read-only check after dismissing its toast", () => {
  const html = renderToStaticMarkup(createElement(components.FaucetStatus, { tone: "pending", description: "Claim awaiting verification. No automatic retry.", onCheck: () => {} }));
  assert.match(html, /faucet-feedback is-pending/);
  assert.match(html, /Check balance/);
  assert.doesNotMatch(html, /Test THRU confirmed/);
});

test("history badges never color an unknown execution green", () => {
  for (const [status, tone, label] of [["confirmed", "success", "Confirmed"], ["failed", "error", "Failed"], ["pending", "pending", "Unverified"], ["unavailable", "pending", "Status unavailable"]]) {
    const html = renderToStaticMarkup(createElement(components.TransactionStatusBadge, { status, vmError: status === "failed" ? -763 : null }));
    assert.match(html, new RegExp(`transaction-status is-${tone}`));
    assert.match(html, new RegExp(label));
  }
});
