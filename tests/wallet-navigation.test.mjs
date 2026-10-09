import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { Pubkey, Transaction, keys } from "@thru/sdk";
import { buildWalletAccountContext, encodeValidateInstruction, PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import { defaultCambrianConfig } from "../packages/config/src/index.ts";
import { base64ToBytes, bytesToBase64 } from "../packages/cambrian-sdk/src/abi.ts";
import { savePendingPulse } from "../apps/web/src/pulse-receipts.ts";
import { makeWalletSetupTransaction, makeWalletBirthTransaction } from "./fixtures/activity-transactions.ts";

// Real React reconciliation and Cambrian read hooks, with an offline wallet/RPC.
// This is a DOM unit test, not browser visual QA or passkey/transaction approval.
const walletA = Pubkey.from(new Uint8Array(32).fill(0x44)).toThruFmt();
const walletB = Pubkey.from(new Uint8Array(32).fill(0x55)).toThruFmt();
const globals = ["window", "document", "navigator", "HTMLElement", "MouseEvent", "PopStateEvent", "sessionStorage", "requestAnimationFrame", "cancelAnimationFrame", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__cambrianLayoutTest"];
let server, App, dom, root, savedGlobals, fixture;

before(async () => {
  const virtualWallet = "virtual:cambrian-layout-wallet";
  server = await createServer({
    root: fileURLToPath(new URL("../apps/web", import.meta.url)),
    resolve: { alias: [{ find: "@thru/wallet/react", replacement: virtualWallet }] },
    plugins: [{
      name: "offline-wallet-for-layout-tests",
      resolveId: id => id === virtualWallet ? `\0${virtualWallet}` : undefined,
      load: id => id === `\0${virtualWallet}` ? `
        export const ThruNetwork = { Betanet: 'betanet' };
        export function useWallet() { return globalThis.__cambrianLayoutTest.wallet; }
        export function useThru() { return { thru: globalThis.__cambrianLayoutTest.client }; }
      ` : undefined,
    }],
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "silent",
  });
  App = (await server.ssrLoadModule("/src/App.tsx")).default;
});

after(async () => { await server?.close(); });

beforeEach(async () => {
  savedGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<div id="root"></div>', { url: "http://127.0.0.1:5173/app", pretendToBeVisual: true });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  for (const key of ["window", "document", "navigator", "HTMLElement", "MouseEvent", "PopStateEvent", "sessionStorage"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? dom.window : dom.window[key] });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => { throw new Error("Network access is forbidden in wallet layout tests"); };
  fixture = {
    reads: [], connects: 0, ensures: 0, deposits: 0, menuCalls: 0,
    menuResult: async () => ({ action: "closed" }),
    readGate: null,
    balances: new Map([[walletA, 200n], [walletB, 17n]]),
  };
  fixture.client = {
    helpers: { createPubkey: value => Pubkey.from(value) },
    accounts: {
      get: async value => {
        fixture.reads.push(value);
        const balance = fixture.balances.get(value) ?? 0n;
        if (fixture.readGate) await fixture.readGate;
        return { address: Pubkey.from(value), meta: { balance, dataSize: 0 } };
      },
      list: async () => ({ accounts: [], page: {} }),
    },
    transactions: { listForAccount: async () => ({ transactions: [], page: {} }) },
  };
  fixture.wallet = {
    selectedAccount: { address: walletA, label: "Primary wallet" }, isConnected: true,
    isConnecting: false, isWalletAvailabilityLoading: false,
    wallet: {},
    connect: async () => { fixture.connects++; throw new Error("Unexpected connection request"); },
    openAccountMenu: async () => { fixture.menuCalls++; return fixture.menuResult(); },
    ensureDepositAccount: async () => { fixture.ensures++; return {}; },
    deposit: async () => { fixture.deposits++; return {}; },
  };
  globalThis.__cambrianLayoutTest = fixture;
  root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(createElement(App)); });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  root = null;
  dom?.window.close();
  for (const [key, descriptor] of savedGlobals ?? []) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

const click = async selector => {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing ${selector}`);
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
};

test("Overview → Organisms → Activity → Learn keeps the same wallet, header, sidebar, and verified balance", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  const header = document.querySelector(".dashboard-app-header");
  const sidebar = document.querySelector(".sidebar");
  assert.match(launcher.textContent, /Primary wallet/);
  assert.match(launcher.textContent, /200 THRU/);
  assert.equal(document.querySelectorAll(".wallet-launcher").length, 1);
  assert.ok(document.querySelector(".dashboard-page-actions .faucet-button"));
  let previousContent = document.querySelector(".dashboard-route-content");
  for (const [path, title] of [["/app/organisms", "The living collection"], ["/app/activity", "A clear chain of events"], ["/app/learn", "Start with the living parts"], ["/app", "Your ecosystem"]]) {
    await click(`.sidebar-nav a[href="${path}"]`);
    assert.equal(document.querySelector(".wallet-launcher"), launcher);
    assert.equal(document.querySelector(".dashboard-app-header"), header);
    assert.equal(document.querySelector(".sidebar"), sidebar);
    assert.match(launcher.textContent, /200 THRU/);
    assert.doesNotMatch(launcher.textContent, /Reading|Checking|Waiting/);
    assert.equal(document.querySelector(".dashboard-app-heading h1").textContent, title);
    assert.notEqual(document.querySelector(".dashboard-route-content"), previousContent);
    previousContent = document.querySelector(".dashboard-route-content");
  }
  assert.deepEqual(fixture.reads, [walletA], "Changing page must not restart the wallet's balance read");
  assert.equal(fixture.connects, 0);
  assert.equal(document.querySelectorAll(".wallet-launcher").length, 1);
});

test("landing removes the wallet control while reopening the app retains the selected official account", async () => {
  await click('.back-home-link[href="/"]');
  assert.ok(document.querySelector(".landing-page"));
  assert.equal(document.querySelector(".wallet-launcher"), null);
  assert.equal(document.querySelector(".dashboard-app-header"), null);
  await click('.nav-cta[href="/app"]');
  assert.match(document.querySelector(".wallet-launcher").textContent, /Primary wallet/);
  assert.match(document.querySelector(".wallet-launcher").textContent, /200 THRU/);
  assert.equal(fixture.connects, 0);
  assert.deepEqual(fixture.reads, [walletA, walletA]);
});

test("native view-transition updates preserve the live wallet before and after the destination snapshot", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  let transitions = 0;
  document.startViewTransition = update => {
    transitions++;
    assert.equal(document.querySelector(".wallet-launcher"), launcher);
    const updateCallbackDone = Promise.resolve().then(() => {
      update();
      assert.equal(document.querySelector(".wallet-launcher"), launcher);
      assert.match(launcher.textContent, /200 THRU/);
    });
    return { updateCallbackDone, ready: updateCallbackDone, finished: updateCallbackDone, skipTransition() {} };
  };
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(document.querySelector(".dashboard-app-heading h1").textContent, "The living collection");
  await click('.sidebar-nav a[href="/app"]');
  assert.equal(document.querySelector(".dashboard-app-heading h1").textContent, "Your ecosystem");
  assert.equal(transitions, 2);
  assert.deepEqual(fixture.reads, [walletA]);
});

test("history Back and Forward preserve the wallet and balance across dashboard routes", { timeout: 5_000 }, async () => {
  const launcher = document.querySelector(".wallet-launcher");
  await click('.sidebar-nav a[href="/app/organisms"]');
  await click('.sidebar-nav a[href="/app/activity"]');
  for (const [direction, path] of [["back", "/app/organisms"], ["back", "/app"], ["forward", "/app/organisms"], ["forward", "/app/activity"]]) {
    await act(async () => {
      await new Promise(resolve => {
        dom.window.addEventListener("popstate", resolve, { once: true });
        dom.window.history[direction]();
      });
    });
    assert.equal(dom.window.location.pathname, path);
    assert.equal(document.querySelector(".wallet-launcher"), launcher);
    assert.match(launcher.textContent, /200 THRU/);
  }
  assert.deepEqual(fixture.reads, [walletA]);
});

test("a mocked faucet receipt refreshes the shared wallet without remounting it or requesting funds on navigation", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  let claims = 0;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /\/faucet\/claim$/);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { address: walletA });
    claims++;
    fixture.balances.set(walletA, 300n);
    return { ok: true, status: 200, json: async () => ({ status: "confirmed", requestId: "offline-layout-claim", address: walletA, amount: "100" }) };
  };
  await click(".dashboard-page-actions .faucet-button");
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.match(launcher.textContent, /300 THRU/);
  assert.match(document.querySelector(".faucet-feedback").textContent, /100 THRU received/);
  assert.equal(claims, 1);
  const reads = fixture.reads.length;
  await click('.sidebar-nav a[href="/app/organisms"]');
  await click('.sidebar-nav a[href="/app"]');
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.match(launcher.textContent, /300 THRU/);
  assert.equal(fixture.reads.length, reads);
  assert.equal(claims, 1);
});

test("a pending mocked faucet request is aborted on page change and cannot update the shared wallet later", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  let resolveClaim, signal, claims = 0;
  globalThis.fetch = async (_url, options) => {
    claims++;
    signal = options.signal;
    return new Promise(resolve => { resolveClaim = resolve; });
  };
  await click(".dashboard-page-actions .faucet-button");
  assert.equal(claims, 1);
  assert.equal(signal.aborted, false);
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(signal.aborted, true);
  const reads = fixture.reads.length;
  await act(async () => {
    resolveClaim({ ok: true, status: 200, json: async () => ({ status: "confirmed", requestId: "stale-offline-claim", address: walletA, amount: "100" }) });
  });
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.match(launcher.textContent, /200 THRU/);
  assert.equal(document.querySelector(".faucet-feedback"), null);
  assert.equal(fixture.reads.length, reads);
  assert.equal(claims, 1);
});

test("the persistent launcher refreshes its balance after a completed official Add funds action", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  fixture.menuResult = async () => ({ action: "deposit", selectedAccount: { address: walletA } });
  fixture.wallet.deposit = async () => { fixture.deposits++; fixture.balances.set(walletA, 250n); return {}; };
  await act(async () => { root.render(createElement(App)); });
  await click(".wallet-launcher");
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.match(launcher.textContent, /250 THRU/);
  assert.equal(fixture.ensures, 1);
  assert.equal(fixture.deposits, 1);
  assert.deepEqual(fixture.reads, [walletA, walletA]);
});

test("page changes invalidate old official-menu follow-up actions without replacing the wallet button", async () => {
  let resolveMenu;
  fixture.menuResult = () => new Promise(resolve => { resolveMenu = resolve; });
  const launcher = document.querySelector(".wallet-launcher");
  await click(".wallet-launcher");
  assert.equal(launcher.getAttribute("aria-expanded"), "true");
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  await act(async () => { resolveMenu({ action: "deposit", selectedAccount: { address: walletA } }); });
  assert.equal(fixture.ensures, 0);
  assert.equal(fixture.deposits, 0);
  assert.equal(launcher.getAttribute("aria-expanded"), "false");
  assert.equal(launcher.disabled, false);
});

test("a wallet switch never retains the previous account's balance in the persistent header", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  let finishRead;
  fixture.readGate = new Promise(resolve => { finishRead = resolve; });
  fixture.wallet.selectedAccount = { address: walletB, label: "Second wallet" };
  await act(async () => { root.render(createElement(App)); });
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.match(launcher.textContent, /Second wallet/);
  assert.doesNotMatch(launcher.textContent, /200 THRU|Primary wallet/);
  await act(async () => { finishRead(); });
  assert.match(launcher.textContent, /17 THRU/);
  assert.deepEqual(fixture.reads, [walletA, walletB]);
});

test("switching A → fresh B → A separates history labels and counters without changing the wallet launcher", async () => {
  const launcher = document.querySelector(".wallet-launcher");
  fixture.client.transactions.listForAccount = async value => ({
    transactions: value === walletA ? [makeWalletBirthTransaction(walletA)] : [makeWalletSetupTransaction(walletB)], page: {},
  });
  const expectCounters = (actions, transactions) => {
    const cards = [...document.querySelectorAll(".stat-card.is-activity")];
    assert.deepEqual(cards.map(card => [card.querySelector("p").textContent, card.querySelector("strong").textContent]), [
      ["Cambrian actions", String(actions)], ["Wallet transactions", String(transactions)],
    ]);
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  assert.match(document.querySelector(".activity-timeline").textContent, /Organism birth/);
  await click('.sidebar-nav a[href="/app"]');
  expectCounters(1, 1);
  fixture.wallet.selectedAccount = { address: walletB, label: "Fresh wallet" };
  await act(async () => { root.render(createElement(App)); });
  expectCounters(0, 1);
  assert.match(document.querySelector(".activity-panel").textContent, /Wallet created|Passkey registration/);
  assert.doesNotMatch(document.querySelector(".activity-panel").textContent, /Organism birth/);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  await click('.sidebar-nav a[href="/app/activity"]');
  assert.match(document.querySelector(".activity-timeline").textContent, /Wallet created/);
  fixture.wallet.selectedAccount = { address: walletA, label: "Primary wallet" };
  await act(async () => { root.render(createElement(App)); });
  assert.match(document.querySelector(".activity-timeline").textContent, /Organism birth/);
  assert.doesNotMatch(document.querySelector(".activity-timeline").textContent, /Wallet created/);
  await click('.sidebar-nav a[href="/app"]');
  expectCounters(1, 1);
});

test("a late history response from wallet A cannot overwrite freshly selected wallet B", async () => {
  let finishHistory;
  fixture.client.transactions.listForAccount = value => value === walletA
    ? new Promise(resolve => { finishHistory = resolve; })
    : Promise.resolve({ transactions: [makeWalletSetupTransaction(walletB)], page: {} });
  await click('.sidebar-nav a[href="/app/activity"]');
  fixture.wallet.selectedAccount = { address: walletB, label: "Fresh wallet" };
  await act(async () => { root.render(createElement(App)); });
  assert.match(document.querySelector(".activity-timeline").textContent, /Wallet created/);
  await act(async () => { finishHistory({ transactions: [makeWalletBirthTransaction(walletA)], page: {} }); });
  assert.match(document.querySelector(".activity-timeline").textContent, /Wallet created/);
  assert.doesNotMatch(document.querySelector(".activity-timeline").textContent, /Organism birth/);
  assert.equal(fixture.connects, 0);
});

const historyPage = (address, prefix, count = 10) => Array.from({ length: count }, (_, index) => ({
  ...makeWalletSetupTransaction(address),
  slot: BigInt(622275 - index),
  getSignature: () => ({ toThruFmt: () => `${prefix}-public-receipt-${index}` }),
}));

test("Activity pages use the RPC cursor and page size, and Previous/Next reuse visited pages", async () => {
  const requests = [];
  const launcher = document.querySelector(".wallet-launcher");
  fixture.client.transactions.listForAccount = async (address, { page }) => {
    requests.push({ address, token: page.pageToken, size: page.pageSize });
    return page.pageToken ? { transactions: historyPage(address, "older", 2), page: {} }
      : { transactions: historyPage(address, "newest"), page: { nextPageToken: "older-cursor" } };
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  assert.equal(document.querySelectorAll(".timeline-item").length, 10);
  assert.match(document.querySelector(".activity-pagination").textContent, /10 transactions on this page.*Page 1/);
  assert.equal(document.querySelector('[aria-label="Previous activity page"]').disabled, true);
  assert.equal(document.querySelector('[aria-label="Next activity page"]').disabled, false);
  const scrolls = [];
  document.querySelector(".activity-page-card").scrollIntoView = options => scrolls.push(options);
  await click('[aria-label="Next activity page"]');
  assert.equal(document.querySelectorAll(".timeline-item").length, 2);
  assert.match(document.querySelector(".activity-pagination").textContent, /Page 2/);
  assert.match(document.querySelector(".activity-pagination").textContent, /End of history/);
  assert.equal(document.querySelector('[aria-label="Next activity page"]').disabled, true);
  await click('[aria-label="Previous activity page"]');
  assert.equal(document.querySelectorAll(".timeline-item").length, 10);
  await click('[aria-label="Next activity page"]');
  assert.equal(document.querySelectorAll(".timeline-item").length, 2);
  assert.deepEqual(scrolls, [{ block: "start", behavior: "smooth" }, { block: "start", behavior: "smooth" }, { block: "start", behavior: "smooth" }]);
  assert.deepEqual(requests, [{ address: walletA, token: undefined, size: 10 }, { address: walletA, token: "older-cursor", size: 10 }]);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.equal(fixture.connects, 0);
});

test("a pending page read keeps receipts visible and locks repeat clicks; failure preserves the page and can be retried", async () => {
  let rejectRead;
  let olderCalls = 0;
  fixture.client.transactions.listForAccount = async (address, { page }) => {
    if (!page.pageToken) return { transactions: historyPage(address, "newest"), page: { nextPageToken: "older-cursor" } };
    olderCalls++;
    if (olderCalls === 1) return new Promise((_resolve, reject) => { rejectRead = reject; });
    return { transactions: historyPage(address, "older", 3), page: {} };
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  const next = document.querySelector('[aria-label="Next activity page"]');
  await act(async () => {
    next.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    next.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(olderCalls, 1);
  assert.equal(document.querySelectorAll(".timeline-item").length, 10);
  assert.equal(document.querySelector('[aria-label="Next activity page"]').disabled, true);
  assert.equal(document.querySelector('[aria-label="Previous activity page"]').disabled, true);
  assert.equal(document.querySelector(".activity-history-body").getAttribute("aria-busy"), "true");
  assert.match(document.querySelector(".activity-load-status").textContent, /Loading page 2/);
  await act(async () => { rejectRead(new Error("Offline RPC read failed")); });
  assert.match(document.querySelector(".activity-pagination").textContent, /Page 1/);
  assert.match(document.querySelector(".activity-page-error").textContent, /Couldn't load page 2.*current page is unchanged/);
  assert.equal(document.querySelectorAll(".timeline-item").length, 10);
  await click(".activity-page-error button");
  assert.equal(olderCalls, 2);
  assert.equal(document.querySelector(".activity-page-error"), null);
  assert.match(document.querySelector(".activity-pagination").textContent, /Page 2/);
  assert.equal(document.querySelectorAll(".timeline-item").length, 3);
});

test("refresh on an older page clears its cursors and reads the newest page again", async () => {
  const tokens = [];
  let revision = 0;
  fixture.client.transactions.listForAccount = async (address, { page }) => {
    tokens.push(page.pageToken);
    return page.pageToken ? { transactions: historyPage(address, "older", 1), page: {} }
      : { transactions: historyPage(address, `newest-${revision}`), page: { nextPageToken: "older-cursor" } };
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  await click('[aria-label="Next activity page"]');
  revision++;
  await click(".activity-refresh");
  assert.match(document.querySelector(".activity-pagination").textContent, /Page 1/);
  assert.match(document.querySelector(".activity-timeline").innerHTML, /newest-1-public-receipt/);
  assert.doesNotMatch(document.querySelector(".activity-timeline").innerHTML, /older-public-receipt|newest-0-public-receipt/);
  assert.deepEqual(tokens, [undefined, "older-cursor", undefined]);
});

test("switching wallets from an older activity page resets to page one with a fresh account cursor", async () => {
  const requests = [];
  const launcher = document.querySelector(".wallet-launcher");
  fixture.client.transactions.listForAccount = async (address, { page }) => {
    requests.push([address, page.pageToken]);
    if (address === walletB) return { transactions: historyPage(address, "wallet-B", 1), page: {} };
    return { transactions: historyPage(address, page.pageToken ? "A-older" : "A-newest", 10), page: page.pageToken ? {} : { nextPageToken: "A-older-cursor" } };
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  await click('[aria-label="Next activity page"]');
  fixture.wallet.selectedAccount = { address: walletB, label: "Fresh wallet" };
  await act(async () => { root.render(createElement(App)); });
  assert.match(document.querySelector(".activity-pagination").textContent, /1 transaction on this page.*Page 1/);
  assert.match(document.querySelector(".activity-timeline").innerHTML, /wallet-B-public-receipt/);
  assert.doesNotMatch(document.querySelector(".activity-timeline").innerHTML, /A-older|A-newest/);
  assert.deepEqual(requests, [[walletA, undefined], [walletA, "A-older-cursor"], [walletB, undefined]]);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
});

test("a late older-page response cannot populate the new wallet or restore history after disconnect", async () => {
  let finishOlder;
  fixture.client.transactions.listForAccount = async (address, { page }) => {
    if (address === walletB) return { transactions: historyPage(address, "wallet-B", 1), page: {} };
    if (page.pageToken) return new Promise(resolve => { finishOlder = resolve; });
    return { transactions: historyPage(address, "wallet-A"), page: { nextPageToken: "older-cursor" } };
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  await click('[aria-label="Next activity page"]');
  fixture.wallet.selectedAccount = { address: walletB, label: "Fresh wallet" };
  await act(async () => { root.render(createElement(App)); });
  await act(async () => { finishOlder({ transactions: historyPage(walletA, "stale-A", 4), page: {} }); });
  assert.match(document.querySelector(".activity-timeline").innerHTML, /wallet-B-public-receipt/);
  assert.doesNotMatch(document.querySelector(".activity-timeline").innerHTML, /stale-A/);
  fixture.wallet.isConnected = false;
  fixture.wallet.selectedAccount = null;
  await act(async () => { root.render(createElement(App)); });
  assert.equal(document.querySelector(".activity-timeline"), null);
  assert.equal(document.querySelector(".activity-pagination"), null);
  assert.match(document.querySelector(".activity-page-card").textContent, /Your history starts here.*Connect Thru Wallet/);
  assert.doesNotMatch(document.querySelector(".activity-page-card").innerHTML, /wallet-B-public-receipt|stale-A/);
});

test("a repeated network cursor is reported as an error rather than looping through the same history", async () => {
  fixture.client.transactions.listForAccount = async (address, { page }) => ({
    transactions: historyPage(address, page.pageToken ? "repeated" : "newest"), page: { nextPageToken: "same-cursor" },
  });
  await click('.sidebar-nav a[href="/app/activity"]');
  await click('[aria-label="Next activity page"]');
  assert.match(document.querySelector(".activity-page-error").textContent, /network repeated a history page/);
  assert.match(document.querySelector(".activity-pagination").textContent, /Page 1/);
  assert.doesNotMatch(document.querySelector(".activity-timeline").innerHTML, /repeated-public-receipt/);
});

test("the first-page error offers a read-only retry, and an empty page does not invent older records", async () => {
  let calls = 0;
  fixture.client.transactions.listForAccount = async () => {
    calls++;
    if (calls === 1) throw new Error("RPC temporarily unavailable");
    return { transactions: [], page: {} };
  };
  await click('.sidebar-nav a[href="/app/activity"]');
  assert.match(document.querySelector(".activity-page-card").textContent, /Couldn't load activity.*RPC temporarily unavailable/);
  assert.equal(document.querySelector(".activity-pagination"), null);
  await click(".read-state-retry");
  assert.match(document.querySelector(".activity-page-card").textContent, /No transactions yet/);
  assert.match(document.querySelector(".activity-pagination").textContent, /0 transactions on this page.*End of history.*Page 1/);
  assert.equal(document.querySelector('[aria-label="Next activity page"]').disabled, true);
  assert.equal(document.querySelector('[aria-label="Previous activity page"]').disabled, true);
  assert.equal(calls, 2);
  assert.equal(fixture.connects, 0);
});

test("page navigation honors reduced motion and never remounts the official wallet", async () => {
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  fixture.client.transactions.listForAccount = async (address, { page }) => ({ transactions: historyPage(address, "receipt", 1), page: page.pageToken ? {} : { nextPageToken: "older-cursor" } });
  const launcher = document.querySelector(".wallet-launcher");
  await click('.sidebar-nav a[href="/app/activity"]');
  const scrolls = [];
  document.querySelector(".activity-page-card").scrollIntoView = options => scrolls.push(options);
  await click('[aria-label="Next activity page"]');
  assert.deepEqual(scrolls, [{ block: "start", behavior: "auto" }]);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
});

test("leaving Activity invalidates a pending older-page response without restoring a hidden history panel", async () => {
  let finishOlder;
  fixture.client.transactions.listForAccount = async (address, { page }) => page.pageToken
    ? new Promise(resolve => { finishOlder = resolve; })
    : { transactions: historyPage(address, "newest"), page: { nextPageToken: "older-cursor" } };
  await click('.sidebar-nav a[href="/app/activity"]');
  await click('[aria-label="Next activity page"]');
  const launcher = document.querySelector(".wallet-launcher");
  await click('.sidebar-nav a[href="/app/organisms"]');
  await act(async () => { finishOlder({ transactions: historyPage(walletA, "stale-older", 2), page: {} }); });
  assert.equal(document.querySelector(".activity-page-card"), null);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.equal(window.location.pathname, "/app/organisms");
});

// Pulse interaction tests use real SDK encoding/transport logic and synthetic
// wallet bytes. There are no real WebAuthn credentials or chain submissions.
async function setupPulseFixture() {
  const program = defaultCambrianConfig.programId;
  const organismA = Pubkey.from(new Uint8Array(32).fill(0x66)).toThruFmt();
  const organismB = Pubkey.from(new Uint8Array(32).fill(0x77)).toThruFmt();
  const privateKey = new Uint8Array(32).fill(0x21);
  const feePayer = Pubkey.from(await keys.fromPrivateKey(privateKey)).toThruFmt();
  const pulse = { approvals: 0, sends: 0, statusReads: 0, intents: [], slot: 125n, reject: false, vmError: 0,
    approvalGate: null, sendGate: null, raw: null, signature: null, organismA, organismB,
    states: new Map([[organismA, { controller: walletA, born: 100n, last: 123n, count: 0n, energy: 2048n, vitality: 768n }],
      [organismB, { controller: walletB, born: 101n, last: 123n, count: 0n, energy: 1900n, vitality: 700n }]]) };
  const account = address => {
    const state = pulse.states.get(address);
    if (!state) return { address: Pubkey.from(address), meta: { balance: fixture.balances.get(address) ?? 0n, dataSize: 0 } };
    const data = new Uint8Array(264); const view = new DataView(data.buffer);
    view.setUint32(0, 0x43414d42, true); view.setUint8(4, 1); view.setUint8(5, 1);
    data.set(Pubkey.from(state.controller).toBytes(), 8);
    view.setBigUint64(200, state.born, true); view.setBigUint64(208, state.last, true);
    view.setBigUint64(224, state.energy, true); view.setBigUint64(232, state.vitality, true); view.setBigUint64(240, state.count, true);
    return { address: Pubkey.from(address), meta: { owner: Pubkey.from(program), dataSize: 264, seq: state.count + 1n }, data: { data, compressed: false } };
  };
  fixture.client.node = { getStatus: async () => ({ ready: true, locallyExecutedSlot: pulse.slot }) };
  fixture.client.accounts.get = async address => account(typeof address === "string" ? address : address.toThruFmt());
  fixture.client.accounts.list = async () => ({ accounts: [...pulse.states.keys()].map(account), page: {} });
  fixture.wallet.wallet = { connected: true,
    getSigningContext: async () => ({ selectedAccountPublicKey: fixture.wallet.selectedAccount.address }),
    signTransaction: async intent => {
      pulse.approvals++;
      pulse.intents.push(intent);
      if (pulse.approvalGate) await pulse.approvalGate;
      if (pulse.reject) throw new Error("Pulse approval rejected");
      const context = buildWalletAccountContext({ walletAddress: intent.walletAddress,
        readWriteAccounts: intent.readWriteAddresses.map(address => Pubkey.from(address).toBytes()), readOnlyAccounts: intent.readOnlyAddresses.map(address => Pubkey.from(address).toBytes()) });
      const tx = new Transaction({ feePayer, program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
        header: { fee: 1n, nonce: BigInt(pulse.approvals), startSlot: pulse.slot, stateUnits: intent.stateUnits },
        accounts: { readWriteAccounts: intent.readWriteAddresses, readOnlyAccounts: intent.readOnlyAddresses },
        instructionData: encodeValidateInstruction({ walletAccountIdx: context.walletAccountIdx, authIdx: 0,
          targetInstruction: { programIdx: context.getAccountIndex(Pubkey.from(program).toBytes()), instructionData: base64ToBytes(intent.instructionData) },
          signatureR: new Uint8Array(32).fill(1), signatureS: new Uint8Array(32).fill(2), authenticatorData: new Uint8Array(37),
          clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get","origin":"https://test.invalid"}') }),
      });
      await tx.sign(privateKey); pulse.raw = tx.toWire(); pulse.signature = tx.getSignature().toThruFmt();
      return bytesToBase64(pulse.raw);
    },
  };
  fixture.client.transactions.sendAndTrack = async function* (raw) {
    pulse.sends++;
    assert.deepEqual(raw, pulse.raw);
    if (pulse.sendGate) { await pulse.sendGate; throw new Error("Stream interrupted"); }
    if (!pulse.vmError) {
      const state = pulse.states.get(organismA); state.count++; state.last = pulse.slot; state.energy = 2020n; state.vitality = 769n; pulse.slot++;
    }
    yield { status: 2 };
    yield { executionResult: { vmError: pulse.vmError, userErrorCode: pulse.vmError ? 0xca010010n : 0n } };
  };
  fixture.client.transactions.getStatus = async () => { pulse.statusReads++; return { executionResult: { vmError: 0, userErrorCode: 0n } }; };
  return pulse;
}

test("Pulse updates real traits after approval, keeps the wallet launcher and labels Activity", async () => {
  const pulse = await setupPulseFixture();
  const launcher = document.querySelector(".wallet-launcher");
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(document.querySelector(".pulse-submit").disabled, false);
  assert.equal(document.querySelectorAll(".organism-selector").length, 0, "Wallet B's organism must not enter A's selection");
  await click(".pulse-submit");
  assert.equal(pulse.approvals, 1); assert.equal(pulse.sends, 1);
  assert.match(document.querySelector(".trait-section").textContent, /2020.*769.*1/);
  assert.match(document.querySelector('[aria-label="Pulse transaction progress"]').textContent, /Pulse complete.*4 of 4 steps complete/);
  assert.ok(document.querySelector(".birth-progress.is-success"));
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  const tx = Transaction.fromWire(pulse.raw); tx.executionResult = { vmError: 0, userErrorCode: 0n };
  fixture.client.transactions.listForAccount = async () => ({ transactions: [tx], page: {} });
  await click('.sidebar-nav a[href="/app/activity"]');
  assert.match(document.querySelector(".activity-timeline").textContent, /Organism pulse.*Confirmed/);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
});

test("Pulse locks repeated clicks while awaiting approval and reports rejection without sending", async () => {
  const pulse = await setupPulseFixture(); let release;
  pulse.approvalGate = new Promise(resolve => { release = resolve; }); pulse.reject = true;
  await click('.sidebar-nav a[href="/app/organisms"]');
  const button = document.querySelector(".pulse-submit");
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  assert.equal(pulse.approvals, 1);
  assert.equal(document.querySelector(".pulse-submit").disabled, true);
  assert.match(document.querySelector(".birth-progress.is-pending").textContent, /Confirm Pulse in Thru Wallet/);
  await act(async () => { release(); });
  assert.equal(pulse.sends, 0);
  assert.match(document.querySelector(".birth-progress.is-error").textContent, /approval rejected/);
  assert.equal(document.querySelector(".pulse-submit").disabled, false);
});

test("a second deliberate Pulse uses a new approval, nonce and baseline rather than replaying the completed receipt", async () => {
  const pulse = await setupPulseFixture();
  await click('.sidebar-nav a[href="/app/organisms"]'); await click(".pulse-submit");
  const first = pulse.signature;
  await click(".pulse-submit");
  assert.equal(pulse.approvals, 2); assert.equal(pulse.sends, 2); assert.notEqual(pulse.signature, first);
  assert.equal(pulse.states.get(pulse.organismA).count, 2n);
  assert.match(document.querySelector(".trait-section").textContent, /PULSE COUNT2/);
  assert.ok(document.querySelector(".birth-progress.is-success"));
  assert.equal(sessionStorage.length, 0);
});

for (const change of ["switch", "disconnect", "navigate"]) {
  test(`a ${change} during Pulse approval cancels sending and suppresses the previous wallet's state`, async () => {
    const pulse = await setupPulseFixture(); let release;
    pulse.approvalGate = new Promise(resolve => { release = resolve; });
    await click('.sidebar-nav a[href="/app/organisms"]'); await click(".pulse-submit");
    if (change === "navigate") await click('.sidebar-nav a[href="/app/activity"]');
    else await act(async () => { fixture.wallet.selectedAccount = change === "switch" ? { address: walletB, label: "Wallet B" } : null; fixture.wallet.isConnected = change === "switch"; root.render(createElement(App)); });
    await act(async () => { release(); });
    assert.equal(pulse.approvals, 1); assert.equal(pulse.sends, 0);
    assert.equal(document.querySelector('[aria-label="Pulse transaction progress"]'), null);
    if (change === "switch") assert.match(document.querySelector(".trait-section").textContent, /1900.*700.*0/);
    if (change === "disconnect") assert.equal(document.querySelector(".pulse-submit"), null);
  });
}

test("expired eligibility disables Pulse and a read-only refresh never requests signing", async () => {
  const pulse = await setupPulseFixture(); pulse.slot = 5000n;
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(document.querySelector(".pulse-submit").disabled, true);
  assert.match(document.querySelector(".pulse-eligibility").textContent, /Pulse window expired/);
  await click(".pulse-refresh");
  assert.equal(pulse.approvals, 0); assert.equal(pulse.sends, 0);
});

test("owned organism selection defaults to latest activity and locks while Pulse approval is open", async () => {
  const pulse = await setupPulseFixture(); let release;
  const latest = Pubkey.from(new Uint8Array(32).fill(0x88)).toThruFmt();
  pulse.states.set(latest, { ...pulse.states.get(pulse.organismA), born: 120n, last: 124n });
  pulse.approvalGate = new Promise(resolve => { release = resolve; });
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(document.querySelector("#organism-selection").value, latest);
  assert.equal(document.querySelectorAll("#organism-selection option").length, 2);
  await act(async () => { const select = document.querySelector("#organism-selection"); select.value = pulse.organismA; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await click(".pulse-submit");
  assert.equal(document.querySelector("#organism-selection").disabled, true);
  assert.ok(pulse.intents[0].readWriteAddresses.includes(pulse.organismA));
  assert.ok(!pulse.intents[0].readWriteAddresses.includes(latest));
  await click('.sidebar-nav a[href="/app/activity"]'); await act(async () => { release(); });
  assert.equal(pulse.sends, 0);
});

test("unavailable Pulse eligibility blocks signing and a read-only retry restores it", async () => {
  const pulse = await setupPulseFixture();
  fixture.client.node.getStatus = async () => { throw new Error("Network eligibility unavailable"); };
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.equal(document.querySelector(".pulse-submit").disabled, true);
  assert.match(document.querySelector(".pulse-eligibility.is-error").textContent, /unavailable/);
  fixture.client.node.getStatus = async () => ({ ready: true, locallyExecutedSlot: 125n });
  await click(".pulse-refresh");
  assert.equal(document.querySelector(".pulse-submit").disabled, false);
  assert.equal(pulse.approvals, 0); assert.equal(pulse.sends, 0);
});

test("failed Pulse is red and preserves its explorer signature, without incrementing traits", async () => {
  const pulse = await setupPulseFixture(); pulse.vmError = -765;
  await click('.sidebar-nav a[href="/app/organisms"]'); await click(".pulse-submit");
  const status = document.querySelector(".birth-progress.is-error");
  assert.match(status.textContent, /Pulse execution failed/);
  assert.ok(status.querySelector(`a[href*="${pulse.signature}"]`));
  assert.equal(pulse.sends, 1);
  assert.match(document.querySelector(".trait-section").textContent, /2048.*768.*0/);
  assert.equal(sessionStorage.length, 0);
});

test("refresh restores only a wallet-scoped Pulse receipt, and Check status never signs or sends again", async () => {
  const pulse = await setupPulseFixture();
  const signature = "ts" + "a".repeat(88);
  const state = pulse.states.get(pulse.organismA); state.count = 1n; state.last = 125n; state.energy = 2020n; state.vitality = 769n;
  savePendingPulse(sessionStorage, defaultCambrianConfig, walletA, { stage: "submitted", signature, walletAddress: walletA,
    programId: defaultCambrianConfig.programId, organismAddress: pulse.organismA, baselinePulseCount: 0n, lastPulseSlot: 123n });
  await click('.sidebar-nav a[href="/app/organisms"]');
  assert.match(document.querySelector(".pulse-submit").textContent, /Check Pulse status/);
  await click(".birth-progress-links button");
  assert.equal(pulse.approvals, 0); assert.equal(pulse.sends, 0); assert.equal(pulse.statusReads, 1);
  assert.match(document.querySelector(".birth-progress.is-success").textContent, /Pulse complete/);
  assert.equal(sessionStorage.length, 0);
});

test("navigation during a silent Pulse submission retains the public receipt and permits read-only recovery", async () => {
  const pulse = await setupPulseFixture(); let release;
  pulse.sendGate = new Promise(resolve => { release = resolve; });
  await click('.sidebar-nav a[href="/app/organisms"]'); await click(".pulse-submit");
  assert.equal(pulse.sends, 1); assert.equal(sessionStorage.length, 1);
  await click('.sidebar-nav a[href="/app/activity"]');
  await act(async () => { release(); });
  assert.equal(document.querySelector('[aria-label="Pulse transaction progress"]'), null);
  const state = pulse.states.get(pulse.organismA); state.count = 1n; state.last = 125n; state.energy = 2020n;
  await click('.sidebar-nav a[href="/app/organisms"]');
  await click(".birth-progress-links button");
  assert.equal(pulse.approvals, 1); assert.equal(pulse.sends, 1);
  assert.ok(document.querySelector(".birth-progress.is-success"));
  assert.equal(sessionStorage.length, 0);
});
