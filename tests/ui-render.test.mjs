import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { ThruProvider } from "@thru/wallet/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

// Render real React components, without a browser, passkey, or network writes.
let server, components, app, faucet, address, wallet, network, presentation;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../apps/web", import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "silent" });
  components = await server.ssrLoadModule("/src/components/TransactionFeedback.tsx");
  app = await server.ssrLoadModule("/src/App.tsx");
  faucet = await server.ssrLoadModule("/src/components/FaucetButton.tsx");
  address = await server.ssrLoadModule("/src/components/AddressDisplay.tsx");
  wallet = await server.ssrLoadModule("/src/components/WalletControl.tsx");
  network = await server.ssrLoadModule("/src/components/NetworkCard.tsx");
  presentation = await server.ssrLoadModule("/src/presentation-model.ts");
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

const renderFaucet = (extra = {}) => renderToStaticMarkup(createElement(faucet.FaucetButton, { stage: "idle", pending: false, connected: true, onClick: () => {}, ...extra }));

test("the faucet button disables disconnected and running claims with clear status text", () => {
  const disconnected = renderFaucet({ connected: false });
  assert.match(disconnected, /disabled=""/);
  assert.match(disconnected, /Connect a wallet first/);
  for (const stage of ["preparing", "requesting", "confirming"]) {
    const html = renderFaucet({ stage });
    assert.match(html, /faucet-button is-pending/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /disabled=""/);
    assert.match(html, /no repeat claim/);
  }
});

test("an idle delayed faucet claim offers an enabled read-only check instead of another claim", () => {
  const html = renderFaucet({ pending: true });
  assert.match(html, /Check balance/);
  assert.match(html, /Read-only · no new claim/);
  assert.match(html, /aria-busy="false"/);
  assert.doesNotMatch(html, /disabled=|Get test THRU/);
});

test("an address is compact visually but keeps the full value in its accessible label and explorer URL", () => {
  const value = "taABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const html = renderToStaticMarkup(createElement(address.AddressDisplay, { value, label: "Wallet 1", compact: true }));
  assert.match(html, /taABCDEF…456789/);
  assert.match(html, new RegExp(`title="${value}"`));
  assert.match(html, new RegExp(`/address/${value}\\?rpc=`));
  assert.match(html, /Copy wallet 1 address/);
  assert.match(html, /Open wallet 1 address in explorer/);
  assert.doesNotMatch(html, /Copied to clipboard/);
});

test("transaction signatures use the transaction explorer route and dark addresses preserve their theme", () => {
  const html = renderToStaticMarkup(createElement(address.AddressDisplay, { value: "transaction-signature", kind: "tx", tone: "dark" }));
  assert.match(html, /address-display is-dark/);
  assert.match(html, /\/tx\/transaction-signature\?rpc=/);
  assert.match(html, /Copy transaction signature/);
  assert.doesNotMatch(html, /\/address\/transaction-signature/);
});

test("empty-state actions appear only when idle; loading and error states do not offer a misleading CTA", () => {
  const action = createElement("button", { type: "button" }, "Connect Thru Wallet");
  const render = extra => renderToStaticMarkup(createElement(app.ReadStateCard, { title: "Your ecosystem starts here", description: "Connect to view your own collection", icon: "wallet", action, ...extra }));
  assert.match(render({}), /Connect Thru Wallet/);
  assert.doesNotMatch(render({ loading: true }), /Connect Thru Wallet/);
  assert.doesNotMatch(render({ tone: "error" }), /Connect Thru Wallet/);
});

test("the wallet launcher is present in the first render, without waiting for an iframe or exposing a custody form", () => {
  const html = renderToStaticMarkup(createElement(ThruProvider, { config: { rpcUrl: "https://rpc.betanet.thru.org", iframeUrl: "https://app.tid.sh/embedded" } }, createElement(wallet.OfficialWalletControl)));
  assert.match(html, /Thru Wallet account controls/);
  assert.match(html, /class="wallet-launcher/);
  assert.match(html, /Checking Thru Wallet/);
  assert.doesNotMatch(html, /Approve in the official wallet/);
  assert.match(html, /thru-logo\.png/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /wallet-popover|recovery phrase|Create a wallet|Import a wallet|local vault/i);
});

test("the empty-state connect action uses the original Thru logo, not a generic wallet glyph", () => {
  const html = renderToStaticMarkup(createElement(ThruProvider, { config: { rpcUrl: "https://rpc.betanet.thru.org", iframeUrl: "https://app.tid.sh/embedded" } }, createElement(wallet.ConnectWalletAction)));
  assert.match(html, /connect-thru-action/);
  assert.match(html, /thru-brand-logo/);
  assert.match(html, /thru-logo\.png/);
  assert.match(html, /Checking Thru Wallet/);
});

test("network information separates the chain name and test environment without claiming a live connection", () => {
  const html = renderToStaticMarkup(createElement(network.NetworkCard));
  assert.match(html, /Thru Betanet · Test network/);
  assert.match(html, /network-environment/);
  assert.match(html, /Testnet/);
  assert.match(html, /Test assets only/);
  assert.match(html, /thru-logo\.png/);
  assert.doesNotMatch(html, /Connected|Online|status-dot/);
});

test("a connected launcher shows the account immediately and opens only an official account menu", () => {
  const model = presentation.walletLauncherPresentation({ address: "account-A", label: "My wallet", connecting: false, balance: "100", balanceStatus: "ready" });
  const html = renderToStaticMarkup(createElement(wallet.WalletLauncherButton, { presentation: model, onClick: () => {} }));
  assert.match(html, /My wallet/);
  assert.match(html, /100 THRU/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Open official Thru Wallet menu/);
  assert.doesNotMatch(html, /<iframe|disabled=|wallet-popover/);
});

test("an approval-pending launcher is disabled and communicates waiting without changing its brand logo", () => {
  const model = presentation.walletLauncherPresentation({ address: null, connecting: true, balance: null, balanceStatus: "loading" });
  const html = renderToStaticMarkup(createElement(wallet.WalletLauncherButton, { presentation: model, onClick: () => {} }));
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Waiting for Thru Wallet/);
  assert.match(html, /status-icon is-pending/);
  assert.match(html, /thru-logo\.png/);
});
