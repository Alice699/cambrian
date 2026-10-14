import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { defaultCambrianConfig as config } from "../packages/config/src/index.ts";
import { executeEncounterTransaction } from "../packages/cambrian-sdk/src/encounter-service.ts";
import { savePendingEncounter, loadPendingEncounter } from "../apps/web/src/encounter-receipts.ts";
import { encounterPresentation } from "../apps/web/src/transaction-model.ts";
import { createEncounterHarness, encounterActor, encounterDonor, encounterOtherOrganism, encounterWallet, encounterOtherWallet } from "./fixtures/encounter-harness.ts";

// Real React + Cambrian hooks with a synthetic offline signer and RPC only.
// No real wallet approval, faucet, transaction, network, or GPU is used here.
const globals = ["window", "document", "navigator", "HTMLElement", "MouseEvent", "PopStateEvent", "sessionStorage", "requestAnimationFrame", "cancelAnimationFrame", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__cambrianEncounterTest"];
let server, App, EncounterStatus, dom, root, savedGlobals, fixture;

before(async () => {
  const walletModule = "virtual:cambrian-encounter-wallet";
  server = await createServer({
    root: fileURLToPath(new URL("../apps/web", import.meta.url)),
    resolve: { alias: [{ find: "@thru/wallet/react", replacement: walletModule }] },
    plugins: [{
      name: "offline-encounter-wallet",
      resolveId: id => id === walletModule ? `\0${id}` : undefined,
      load: id => id === `\0${walletModule}` ? `
        export const ThruNetwork = { Betanet: 'betanet' };
        export function useWallet() { return globalThis.__cambrianEncounterTest.provider; }
        export function useThru() { return { thru: globalThis.__cambrianEncounterTest.client }; }
      ` : undefined,
    }],
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "silent",
  });
  App = (await server.ssrLoadModule("/src/App.tsx")).default;
  EncounterStatus = (await server.ssrLoadModule("/src/components/TransactionFeedback.tsx")).EncounterStatus;
});
after(async () => { await server?.close(); });

beforeEach(() => {
  savedGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<div id="root"></div>', { url: "http://127.0.0.1:5173/app/organisms", pretendToBeVisual: true });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  for (const key of ["window", "document", "navigator", "HTMLElement", "MouseEvent", "PopStateEvent", "sessionStorage"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? dom.window : dom.window[key] });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => { throw new Error("Real network is forbidden in Encounter DOM tests"); };
  root = createRoot(document.getElementById("root"));
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

const rerender = async () => { await act(async () => { root.render(createElement(App)); }); };
const mount = async (options = {}, configure) => {
  fixture = createEncounterHarness(options);
  fixture.provider = {
    wallet: fixture.wallet, selectedAccount: { address: encounterWallet, label: "Wallet A" }, isConnected: true,
    isConnecting: false, isWalletAvailabilityLoading: false,
    connect: async () => { throw new Error("Unexpected connection"); },
    openAccountMenu: async () => ({ action: "closed" }),
  };
  globalThis.__cambrianEncounterTest = fixture;
  await configure?.(fixture);
  await rerender();
  return fixture;
};
const click = async selector => {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing ${selector}`);
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
};
const select = async (selector, value) => {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing ${selector}`);
  await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
};
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(predicate(), "Expected offline UI update did not arrive");
};
const progress = () => document.querySelector('[aria-label="Encounter transaction progress"]');

test("Encounter pairs only distinct organisms in the active wallet; review performs no approval or send", async () => {
  await mount();
  const actors = [...document.querySelectorAll("#organism-selection option")].map(item => item.value);
  const donors = [...document.querySelectorAll("#encounter-partner option")].map(item => item.value);
  assert.deepEqual(actors, [encounterActor, encounterDonor]);
  assert.deepEqual(donors, [encounterDonor]);
  assert.ok(!actors.includes(encounterOtherOrganism));
  await click(".encounter-review-button");
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0); assert.equal(fixture.trace.contextReads, 0);
  assert.match(document.querySelector(".encounter-review").textContent, /Symbiosis/);
  assert.match(document.querySelector(".encounter-review").textContent, /255.*256 matching bits/);
  assert.match(document.querySelector(".encounter-review").textContent, /2,176/);
  assert.match(document.querySelector(".encounter-review").textContent, /appearance can stay the same/);
  assert.match(document.querySelector(".encounter-boundary").textContent, /does not reset the Pulse window/);
});

test("one explicit approval verifies the event and resources, updates Energy, and labels Activity", async () => {
  await mount();
  const launcher = document.querySelector(".wallet-launcher");
  const partnerBefore = fixture.record(encounterDonor).data.data.slice();
  await click(".encounter-review-button");
  await click(".encounter-approve");
  await waitFor(() => progress()?.dataset.stage === "confirmed");
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
  assert.equal(progress().classList.contains("is-success"), true);
  assert.equal(progress().querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "4");
  assert.match(document.querySelector(".encounter-result").textContent, /Symbiosis recorded/);
  assert.match(document.querySelector(".encounter-resources").textContent, /42,501,234/);
  assert.match(document.querySelector(".encounter-resources").textContent, /0 THRU/);
  assert.match(document.querySelector(".encounter-resources").textContent, /including wallet authentication/);
  assert.match(document.querySelector(".encounter-result").textContent, /2,176/);
  assert.equal(loadPendingEncounter(sessionStorage, config, encounterWallet), null);
  assert.deepEqual(fixture.record(encounterDonor).data.data, partnerBefore);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  await click('.sidebar-nav a[href="/app/activity"]');
  assert.match(document.querySelector(".activity-timeline").textContent, /Organism encounter/);
  assert.equal(document.querySelector(".wallet-launcher"), launcher);
  assert.equal(fixture.trace.sends, 1);
});

test("Stress is an amber review with an explicit Energy loss, not a fabricated transaction failure", async () => {
  await mount({ donorBits: 256 });
  await click(".encounter-review-button");
  assert.ok(document.querySelector(".encounter-review.is-stress"));
  assert.match(document.querySelector(".encounter-review").textContent, /-96 Energy/);
  assert.match(document.querySelector(".encounter-review").textContent, /does not copy a genome bit/);
  assert.equal(fixture.trace.sends, 0);
  await click(".encounter-approve");
  await waitFor(() => progress()?.dataset.stage === "confirmed");
  assert.ok(document.querySelector(".encounter-result.is-stress"));
  assert.match(document.querySelector(".encounter-result").textContent, /Stress recorded/);
  assert.equal(progress().classList.contains("is-success"), true);
});

test("approval rejection is red, sends nothing, and requires a fresh review", async () => {
  await mount({ reject: true });
  await click(".encounter-review-button");
  await click(".encounter-approve");
  await waitFor(() => progress()?.dataset.stage === "failed");
  assert.equal(progress().classList.contains("is-error"), true);
  assert.match(progress().textContent, /User rejected Encounter approval/);
  assert.equal(fixture.trace.sends, 0);
  assert.equal(document.querySelector(".encounter-result"), null);
  assert.equal(document.querySelector(".encounter-approve"), null);
  assert.equal(document.querySelector(".encounter-review-button").disabled, false);
});

test("an approval in progress locks both selectors and Pulse and prevents repeated signing", async () => {
  let release;
  await mount({ approvalGate: new Promise(resolve => { release = resolve; }) });
  await click(".encounter-review-button");
  await click(".encounter-approve");
  await waitFor(() => fixture.trace.approvals === 1);
  assert.equal(document.querySelector("#organism-selection").disabled, true);
  assert.equal(document.querySelector("#encounter-partner").disabled, true);
  assert.equal(document.querySelector(".encounter-approve").disabled, true);
  assert.match(document.querySelector(".pulse-card").textContent, /existing Encounter/);
  assert.equal(document.querySelector(".pulse-submit").disabled, true);
  assert.equal(progress().classList.contains("is-pending"), true);
  await click(".encounter-approve");
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 0);
  await act(async () => { release(); });
  await waitFor(() => progress()?.dataset.stage === "confirmed");
  assert.equal(fixture.trace.sends, 1);
});

for (const change of ["wallet switch", "disconnect", "page navigation"]) {
  test(`${change} during approval cancels follow-up sending and hides the old review`, async () => {
    let release;
    await mount({ approvalGate: new Promise(resolve => { release = resolve; }) });
    await click(".encounter-review-button");
    await click(".encounter-approve");
    await waitFor(() => fixture.trace.approvals === 1);
    if (change === "wallet switch") {
      fixture.provider.selectedAccount = { address: encounterOtherWallet, label: "Wallet B" };
      await rerender();
    } else if (change === "disconnect") {
      fixture.provider.isConnected = false;
      await rerender();
    } else await click('.sidebar-nav a[href="/app/activity"]');
    await act(async () => { release(); });
    assert.equal(fixture.trace.sends, 0);
    assert.equal(progress(), null);
    assert.equal(document.querySelector(".encounter-review"), null);
    assert.equal(document.querySelector(".encounter-result"), null);
    assert.equal(loadPendingEncounter(sessionStorage, config, encounterWallet), null);
  });
}

test("changing the actor cancels the quote and excludes the new actor from partner choices", async () => {
  await mount();
  await click(".encounter-review-button");
  await select("#organism-selection", encounterDonor);
  assert.equal(document.querySelector(".encounter-review"), null);
  assert.deepEqual([...document.querySelectorAll("#encounter-partner option")].map(item => item.value), [encounterActor]);
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
});

test("Back to pair cancels only the unsent review and leaves on-chain state unchanged", async () => {
  await mount();
  const original = fixture.record(encounterActor).data.data.slice();
  await click(".encounter-review-button");
  await click(".encounter-cancel");
  assert.equal(document.querySelector(".encounter-review"), null);
  assert.equal(document.querySelector(".encounter-review-button").disabled, false);
  assert.deepEqual(fixture.record(encounterActor).data.data, original);
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
});

test("one owned organism shows the pair empty state, without offering approval", async () => {
  await mount({}, item => { item.states.delete(encounterDonor); });
  assert.match(document.querySelector(".encounter-empty").textContent, /two organisms/);
  assert.equal(document.querySelector(".encounter-review-button"), null);
  assert.equal(document.querySelector(".encounter-approve"), null);
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
});

test("a pair changed after review cannot reach wallet approval", async () => {
  await mount();
  await click(".encounter-review-button");
  fixture.options.changedDonor = true;
  await click(".encounter-approve");
  await waitFor(() => progress()?.dataset.stage === "failed");
  assert.match(progress().textContent, /changed since review/);
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
  assert.equal(document.querySelector(".encounter-approve"), null);
});

test("a mismatched official signing context stops before requesting approval", async () => {
  await mount();
  await click(".encounter-review-button");
  fixture.wallet.getSigningContext = async () => ({ selectedAccountPublicKey: encounterOtherWallet });
  await click(".encounter-approve");
  await waitFor(() => progress()?.dataset.stage === "failed");
  assert.match(progress().textContent, /selected wallet changed/);
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
});

test("known execution failure clears the pending record and never shows a verified result", async () => {
  await mount({ stream: "failed", status: "failed" });
  await click(".encounter-review-button");
  await click(".encounter-approve");
  await waitFor(() => progress()?.dataset.stage === "failed");
  assert.equal(progress().classList.contains("is-error"), true);
  assert.match(progress().textContent, /VM error -765/);
  assert.match(progress().textContent, /View transaction/);
  assert.equal(document.querySelector(".encounter-result"), null);
  assert.equal(loadPendingEncounter(sessionStorage, config, encounterWallet), null);
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
});

test("a dead partner cannot be reviewed or approved", async () => {
  await mount({ deadDonor: true });
  assert.equal(document.querySelector(".encounter-review-button").disabled, true);
  assert.match(document.querySelector(".encounter-action-row").textContent, /dead/i);
  await click(".encounter-review-button");
  assert.equal(document.querySelector(".encounter-review"), null);
  assert.equal(fixture.trace.approvals, 0);
});

test("an existing public receipt resumes with read-only checks and no second approval or send", async () => {
  await mount({}, async item => {
    const receipt = await executeEncounterTransaction(item.client, config, item.wallet, {
      walletAddress: encounterWallet, actorAddress: encounterActor, donorAddress: encounterDonor, catalyst: 1n,
      confirmationTimeoutMs: 0, organismTimeoutMs: 0,
    });
    savePendingEncounter(sessionStorage, config, encounterWallet, receipt);
  });
  assert.equal(progress().classList.contains("is-pending"), true);
  assert.equal(document.querySelector("#organism-selection").disabled, true);
  assert.equal(document.querySelector(".encounter-result"), null);
  assert.match(progress().textContent, /Check status/);
  await click('[aria-label="Encounter transaction progress"] .birth-progress-primary');
  await waitFor(() => progress()?.dataset.stage === "confirmed");
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
  assert.equal(loadPendingEncounter(sessionStorage, config, encounterWallet), null);
  assert.match(document.querySelector(".encounter-result").textContent, /Symbiosis recorded/);
});

test("unreadable actor state still allows checking an existing receipt but cannot offer another Encounter", async () => {
  await mount({}, async item => {
    const receipt = await executeEncounterTransaction(item.client, config, item.wallet, {
      walletAddress: encounterWallet, actorAddress: encounterActor, donorAddress: encounterDonor, catalyst: 1n,
      confirmationTimeoutMs: 0, organismTimeoutMs: 0,
    });
    savePendingEncounter(sessionStorage, config, encounterWallet, receipt);
    item.options.unreadable = true;
  });
  assert.match(document.querySelector(".data-state-card").textContent, /Reading the Encounter organism/);
  assert.equal(document.querySelector(".encounter-approve"), null);
  assert.equal(document.querySelector(".encounter-review-button"), null);
  assert.equal(progress().classList.contains("is-pending"), true);
  assert.match(progress().textContent, /Check status/);
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
});

test("Encounter step announcements keep every unfinished stage yellow and expose verified completion only in green", () => {
  for (const [stage, value, tone] of [["preparing", 0, "pending"], ["awaiting-approval", 0, "pending"], ["signed", 1, "pending"], ["submitting", 1, "pending"], ["submitted", 2, "pending"], ["syncing", 3, "pending"], ["confirmed", 4, "success"], ["failed", 2, "error"]]) {
    const state = encounterPresentation(stage, true);
    assert.equal(state.tone, tone); assert.equal(state.step, value);
    const html = renderToStaticMarkup(createElement(EncounterStatus, { update: { stage, signature: "public-receipt", error: stage === "failed" ? new Error("Rejected") : undefined }, account: encounterWallet }));
    assert.match(html, new RegExp(`birth-progress is-${tone}`));
    assert.match(html, new RegExp(`aria-valuenow="${value}"`));
    assert.match(html, /Verify result/);
    assert.doesNotMatch(html, /[↗→]/u);
    if (stage === "syncing") assert.match(html, /actual Encounter event/);
  }
});

test("Encounter CSS includes mobile stacking, visible focus, reduced motion and touch-sized controls", async () => {
  const css = await readFile(new URL("../apps/web/src/encounter.css", import.meta.url), "utf8");
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /encounter-pair\{grid-template-columns:1fr/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /min-height:44px/);
});
