import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { Pubkey } from "@thru/sdk";

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
