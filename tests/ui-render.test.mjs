import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { ThruProvider } from "@thru/wallet/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

// Render real React components, without a browser, passkey, or network writes.
let server, components, app, faucet, address, wallet, network, presentation, navigation;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../apps/web", import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "silent" });
  components = await server.ssrLoadModule("/src/components/TransactionFeedback.tsx");
  app = await server.ssrLoadModule("/src/App.tsx");
  faucet = await server.ssrLoadModule("/src/components/FaucetButton.tsx");
  address = await server.ssrLoadModule("/src/components/AddressDisplay.tsx");
  wallet = await server.ssrLoadModule("/src/components/WalletControl.tsx");
  network = await server.ssrLoadModule("/src/components/NetworkCard.tsx");
  presentation = await server.ssrLoadModule("/src/presentation-model.ts");
  navigation = await server.ssrLoadModule("/src/navigation.ts");
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

const renderRoute = pathname => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { pathname }, matchMedia: () => ({ matches: false }) };
  try {
    return renderToStaticMarkup(createElement(ThruProvider, { config: { rpcUrl: "https://rpc.betanet.thru.org", iframeUrl: "https://app.tid.sh/embedded" } }, createElement(app.default)));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
};

test("the landing route has no interactive wallet controls, even inside the persistent wallet provider", () => {
  const html = renderRoute("/");
  assert.match(html, /class="landing-page"/);
  assert.match(html, /Open app/);
  assert.doesNotMatch(html, /official-wallet-control|wallet-launcher|connect-wallet-action|account-context/);
});

test("each application route still renders the official wallet launcher", () => {
  for (const pathname of ["/app", "/app/organisms", "/app/activity", "/app/learn"]) {
    const html = renderRoute(pathname);
    assert.match(html, /route-view is-dashboard/);
    assert.equal((html.match(/class="wallet-launcher /g) ?? []).length, 1);
    assert.doesNotMatch(html, /class="landing-page"/);
  }
});

test("wallet transition styles discard the old snapshot instead of keeping a floating wallet on landing", async () => {
  const css = await readFile(new URL("../apps/web/src/wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.route-view\.is-dashboard \.wallet-launcher\s*\{\s*view-transition-name:\s*wallet-launcher;/);
  assert.match(css, /::view-transition-old\(wallet-launcher\)\s*\{[^}]*display:\s*none;/);
  assert.match(css, /::view-transition-new\(wallet-launcher\)\s*\{[^}]*animation:\s*none;/);
});

const withNavigation = (pathname, callback, supportsTransitions = true) => {
  const previous = Object.fromEntries(["window", "document", "PopStateEvent"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [];
  const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => calls.push("prevent") };
  globalThis.window = {
    location: { pathname },
    history: { pushState: (_state, _title, path) => { calls.push(`history:${path}`); globalThis.window.location.pathname = path; } },
    dispatchEvent: event => calls.push(`event:${event.type}`),
  };
  globalThis.document = supportsTransitions ? {
    activeViewTransition: { skipTransition: () => calls.push("skip") },
    startViewTransition: update => {
      calls.push("transition"); update(); calls.push("snapshot");
      return { skipTransition: () => calls.push("skip-route"), ready: Promise.resolve(), finished: Promise.resolve() };
    },
  } : {};
  globalThis.PopStateEvent = class { constructor(type) { this.type = type; } };
  try { callback({ calls, event }); }
  finally {
    navigation.cancelRouteTransition();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
};

test("navigating from any application page to landing cancels old snapshots without starting a new one", () => {
  for (const path of ["/app", "/app/organisms", "/app/activity", "/app/learn"]) {
    withNavigation(path, ({ calls, event }) => {
      navigation.navigateInternal("/", event);
      assert.deepEqual(calls, ["prevent", "skip", "history:/", "event:popstate"]);
      assert.equal(globalThis.window.location.pathname, "/");
    });
  }
});

test("opening the application from landing does not capture an unrelated wallet snapshot", () => {
  withNavigation("/", ({ calls, event }) => {
    navigation.navigateInternal("/app", event);
    assert.deepEqual(calls, ["prevent", "skip", "history:/app", "event:popstate"]);
  });
});

test("transitions between application pages update the route before the destination snapshot", () => {
  withNavigation("/app", ({ calls, event }) => {
    navigation.navigateInternal("/app/activity", event);
    assert.deepEqual(calls, ["prevent", "skip", "transition", "history:/app/activity", "event:popstate", "snapshot"]);
  });
});

test("returning to landing interrupts a tracked transition even in browsers without activeViewTransition", () => {
  withNavigation("/app", ({ calls, event }) => {
    delete globalThis.document.activeViewTransition;
    navigation.navigateInternal("/app/activity", event);
    calls.length = 0;
    navigation.navigateInternal("/", event);
    assert.deepEqual(calls, ["prevent", "skip-route", "history:/", "event:popstate"]);
  });
});

test("browser Back can cancel an in-flight application snapshot without changing wallet or history state", () => {
  withNavigation("/app", ({ calls, event }) => {
    delete globalThis.document.activeViewTransition;
    navigation.navigateInternal("/app/organisms", event);
    globalThis.window.location.pathname = "/";
    calls.length = 0;
    navigation.cancelRouteTransition();
    assert.deepEqual(calls, ["skip-route"]);
    assert.equal(globalThis.window.location.pathname, "/");
  });
});

test("a cancelled transition callback cannot reopen the application after returning to landing", () => {
  withNavigation("/app", ({ calls, event }) => {
    let pendingUpdate;
    globalThis.document.startViewTransition = update => {
      pendingUpdate = update;
      return { skipTransition: () => calls.push("skip-route"), ready: Promise.resolve(), finished: Promise.resolve() };
    };
    navigation.navigateInternal("/app/activity", event);
    navigation.navigateInternal("/", event);
    calls.length = 0;
    pendingUpdate();
    assert.deepEqual(calls, []);
    assert.equal(globalThis.window.location.pathname, "/");
  });
});

test("rapid application navigation ignores the cancelled destination instead of overwriting the latest route", () => {
  withNavigation("/app", ({ calls, event }) => {
    const updates = [];
    globalThis.document.startViewTransition = update => {
      updates.push(update);
      return { skipTransition: () => {}, ready: Promise.resolve(), finished: Promise.resolve() };
    };
    navigation.navigateInternal("/app/organisms", event);
    navigation.navigateInternal("/app/activity", event);
    calls.length = 0;
    updates[0]();
    assert.deepEqual(calls, []);
    updates[1]();
    assert.deepEqual(calls, ["history:/app/activity", "event:popstate"]);
    assert.equal(globalThis.window.location.pathname, "/app/activity");
  });
});

test("internal navigation still works without browser view-transition support", () => {
  withNavigation("/app", ({ calls, event }) => {
    navigation.navigateInternal("/app/organisms", event);
    assert.deepEqual(calls, ["prevent", "history:/app/organisms", "event:popstate"]);
  }, false);
});

test("modified clicks retain native link behavior and never start a wallet transition", () => {
  for (const modification of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    withNavigation("/app", ({ calls, event }) => {
      navigation.navigateInternal("/", { ...event, ...modification });
      assert.deepEqual(calls, []);
    });
  }
});

test("only the /app path boundary belongs to the wallet-enabled application", () => {
  assert.equal(navigation.routeFromPath("/app"), "dashboard");
  assert.equal(navigation.routeFromPath("/app/"), "dashboard");
  assert.equal(navigation.routeFromPath("/app/organisms"), "organisms");
  for (const path of ["/", "/apple", "/application", "/about"]) assert.equal(navigation.routeFromPath(path), "landing");
});
