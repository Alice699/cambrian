import assert from "node:assert/strict";
import test from "node:test";
import { activeThruAddress, birthPresentation, noticeTone, type BirthStage } from "../apps/web/src/transaction-model.ts";
import { clearPendingBirth, loadPendingBirth, savePendingBirth } from "../apps/web/src/birth-receipts.ts";
import type { BirthTransactionResult } from "../packages/cambrian-sdk/src/transaction-service.ts";
import { copyPublicValue, faucetButtonPresentation, officialBalanceLabel, shortPublicAddress, walletLauncherPresentation, type FaucetStage } from "../apps/web/src/presentation-model.ts";
import { openOfficialWalletMenu } from "../apps/web/src/wallet-menu.ts";

test("every unfinished Birth stage is yellow/pending; only completed read is green", () => {
  for (const stage of ["connecting", "preparing", "awaiting-approval", "signed", "submitting", "submitted", "syncing"] as BirthStage[]) {
    assert.equal(birthPresentation(stage).tone, "pending");
  }
  assert.equal(birthPresentation("confirmed").tone, "success");
  assert.equal(birthPresentation("failed").tone, "error");
});

test("stepper moves forward only as real transaction phases complete", () => {
  assert.equal(birthPresentation("awaiting-approval").step, 0);
  assert.equal(birthPresentation("signed").step, 1);
  assert.equal(birthPresentation("submitted").step, 2);
  assert.equal(birthPresentation("syncing").step, 3);
  assert.equal(birthPresentation("confirmed").step, 4);
  assert.equal(birthPresentation("failed", true).step, 2);
});

test("faucet and Birth toasts share the same success, pending, and error semantics", () => {
  for (const action of ["birth", "faucet"]) {
    assert.equal(noticeTone(action), "pending");
    assert.equal(noticeTone(`${action}-submitted`), "pending");
    assert.equal(noticeTone(`${action}-success`), "success");
    assert.equal(noticeTone(`${action}-error`), "error");
  }
});

test("disconnect removes the active address even if the SDK retains a previous selected account", () => {
  assert.equal(activeThruAddress(false, "account-A"), null);
  assert.equal(activeThruAddress(true, null), null);
  assert.equal(activeThruAddress(true, "account-B"), "account-B");
});

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const receipt: BirthTransactionResult = { stage: "submitted", signature: "public-transaction-signature", prepared: {
  organismAddress: "organism-A", seed: new Uint8Array(32), entropy: new Uint8Array(32), proof: new Uint8Array([1, 2]),
  intent: { walletAddress: "account-A", programAddress: "program-A", instructionData: "public-instruction", review: { instruction: "wallet_birth" } },
} };

test("pending receipts are scoped to the exact wallet and program across wallet switches", () => {
  const storage = memoryStorage(); savePendingBirth(storage, "program-A", "account-A", receipt);
  assert.deepEqual(loadPendingBirth(storage, "program-A", "account-A"), receipt);
  assert.equal(loadPendingBirth(storage, "program-A", "account-B"), null);
  assert.equal(loadPendingBirth(storage, "program-B", "account-A"), null);
});

test("clearing an account's receipt never deletes an old local vault or another account's data", () => {
  const storage = memoryStorage(); storage.setItem("old-local-vault", "encrypted-test-data");
  savePendingBirth(storage, "program-A", "account-A", receipt);
  clearPendingBirth(storage, "program-A", "account-A");
  assert.equal(loadPendingBirth(storage, "program-A", "account-A"), null);
  assert.equal(storage.getItem("old-local-vault"), "encrypted-test-data");
});

test("malformed and cross-wallet receipts cannot become active transaction state", () => {
  const storage = memoryStorage(); savePendingBirth(storage, "program-A", "account-A", receipt);
  const key = [...storage.values.keys()][0];
  storage.setItem(key, "{not-json"); assert.equal(loadPendingBirth(storage, "program-A", "account-A"), null);
  storage.setItem(key, JSON.stringify({ ...receipt, prepared: { ...receipt.prepared, intent: { ...receipt.prepared.intent, walletAddress: "account-B" } } }));
  assert.equal(loadPendingBirth(storage, "program-A", "account-A"), null);
});

test("public addresses keep recognizable ends without altering short values", () => {
  const address = "taABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  assert.equal(shortPublicAddress(address), "taABCDEF…456789");
  assert.equal(shortPublicAddress("account-A"), "account-A");
  assert.equal(shortPublicAddress(address, 6, 4), "taABCD…6789");
});

test("the official balance label keeps integer precision and never invents an unavailable balance", () => {
  assert.equal(officialBalanceLabel("2000000000000000001"), "2,000,000,000,000,000,001 THRU");
  assert.equal(officialBalanceLabel(100n), "100 THRU");
  assert.equal(officialBalanceLabel("0"), "0 THRU");
  assert.equal(officialBalanceLabel(null), undefined);
  for (const invalid of ["", "NaN", "Infinity", "-1", "100.5"]) assert.equal(officialBalanceLabel(invalid), undefined);
});

test("faucet presentation makes the selected-wallet requirement explicit", () => {
  const disconnected = faucetButtonPresentation("idle", false, false);
  assert.equal(disconnected.hint, "Connect a wallet first");
  assert.match(disconnected.description, /Connect Thru Wallet/);
  const connected = faucetButtonPresentation("idle", false, true);
  assert.equal(connected.label, "Get test THRU");
  assert.match(connected.description, /selected wallet/);
  assert.match(connected.description, /no monetary value/);
});

test("every running faucet phase is pending and a delayed claim becomes a read-only check", () => {
  for (const stage of ["preparing", "requesting", "confirming"] as FaucetStage[]) {
    const state = faucetButtonPresentation(stage, false, true);
    assert.equal(state.busy, true);
    assert.equal(state.tone, "pending");
    assert.match(state.hint, /no repeat claim/);
  }
  const delayed = faucetButtonPresentation("idle", true, true);
  assert.equal(delayed.busy, false);
  assert.equal(delayed.tone, "pending");
  assert.equal(delayed.label, "Check balance");
  assert.match(delayed.description, /without requesting funds again/);
});

test("clipboard copies the entire public value and reports success only after the write completes", async () => {
  const address = "taABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let copied = "", complete = false, release!: () => void;
  const write = new Promise<void>(resolve => { release = resolve; });
  const result = copyPublicValue(address, { writeText: async value => { copied = value; await write; } }).then(() => { complete = true; });
  assert.equal(copied, address);
  assert.notEqual(copied, shortPublicAddress(address));
  assert.equal(complete, false);
  release(); await result;
  assert.equal(complete, true);
});

test("unavailable or rejected clipboard writes cannot report success", async () => {
  await assert.rejects(copyPublicValue("account-A"), /Clipboard unavailable/);
  await assert.rejects(copyPublicValue("account-A", { writeText: async () => { throw new Error("Permission denied"); } }), /Permission denied/);
});

test("wallet launcher renders its connection action immediately and never leaks an old account's balance", () => {
  const state = walletLauncherPresentation({ address: null, connecting: false, balance: "100", balanceStatus: "ready" });
  assert.equal(state.label, "Connect Thru Wallet");
  assert.equal(state.detail, "Official wallet · Betanet");
  assert.equal(state.connected, false);
  assert.equal(state.busy, false);
  assert.doesNotMatch(state.detail, /100/);
});

test("account labels remain available while the balance loads; unavailable balance is never shown as zero", () => {
  const options = { address: "taABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", label: "My Thru account", connecting: false, balance: null };
  const loading = walletLauncherPresentation({ ...options, balanceStatus: "loading" });
  assert.equal(loading.label, "My Thru account");
  assert.equal(loading.detail, "taABCD…6789 · Thru Betanet");
  assert.equal(loading.connected, true);
  assert.equal(loading.busy, false);
  assert.match(walletLauncherPresentation({ ...options, balanceStatus: "unavailable" }).detail, /Balance unavailable/);
  assert.match(walletLauncherPresentation({ ...options, balanceStatus: "ready", balance: "0" }).detail, /0 THRU/);
});

test("connection approval stays explicitly pending rather than claiming a connected wallet", () => {
  const state = walletLauncherPresentation({ address: null, connecting: true, balance: null, balanceStatus: "loading" });
  assert.equal(state.busy, true);
  assert.equal(state.connected, false);
  assert.match(state.label, /Waiting for Thru Wallet/);
  assert.match(state.detail, /Approve in the official wallet/);
});

test("SDK availability checking is not mistaken for a user approval request", () => {
  const state = walletLauncherPresentation({ address: null, connecting: true, checking: true, balance: null, balanceStatus: "loading" });
  assert.equal(state.label, "Checking Thru Wallet…");
  assert.equal(state.busy, true);
  assert.equal(state.connected, false);
  assert.doesNotMatch(state.detail, /Approve/);
});

type MenuApi = Parameters<typeof openOfficialWalletMenu>[0];
type MenuResult = Awaited<ReturnType<MenuApi["openAccountMenu"]>>;
const menuOptions = { address: "account-A", anchor: { x: 320, y: 40, width: 248, height: 54 }, explorerUrl: "https://scan.thru.org/address/account-A", isCurrent: () => true };
function menuFixture(result: MenuResult) {
  const calls: { name: string; payload?: unknown }[] = [];
  const api: MenuApi = {
    openAccountMenu: async payload => { calls.push({ name: "menu", payload }); return result; },
    ensureDepositAccount: async () => { calls.push({ name: "ensure" }); return {} as Awaited<ReturnType<MenuApi["ensureDepositAccount"]>>; },
    deposit: async payload => { calls.push({ name: "deposit", payload }); return {} as Awaited<ReturnType<MenuApi["deposit"]>>; },
  };
  return { api, calls };
}

test("the launcher opens Thru's official menu at its button anchor with the selected account's real balance", async () => {
  const { api, calls } = menuFixture({ action: "closed" });
  const result = await openOfficialWalletMenu(api, { ...menuOptions, balance: "0 THRU" });
  assert.equal(result?.action, "closed");
  assert.deepEqual(calls, [{ name: "menu", payload: { anchor: menuOptions.anchor, align: "right", network: "Thru Betanet", theme: "light", explorerUrl: menuOptions.explorerUrl, balances: { "account-A": "0 THRU" } } }]);
});

test("switching, account management, and sign-out results never start an unsolicited funding flow", async () => {
  for (const action of ["closed", "switched", "accounts-updated", "signed-out"] as MenuResult["action"][]) {
    const { api, calls } = menuFixture({ action });
    await openOfficialWalletMenu(api, menuOptions);
    assert.deepEqual(calls.map(call => call.name), ["menu"]);
    assert.equal("balances" in (calls[0].payload as object), false);
  }
});

test("only an explicit Add funds action opens the official deposit workflow for the selected account", async () => {
  const { api, calls } = menuFixture({ action: "deposit" });
  await openOfficialWalletMenu(api, menuOptions);
  assert.deepEqual(calls.map(call => call.name), ["menu", "ensure", "deposit"]);
  assert.deepEqual(calls[2].payload, { to: "account-A" });
});

test("a menu response selecting a different account cannot fund the previous account", async () => {
  const { api, calls } = menuFixture({ action: "deposit", selectedAccount: { address: "account-B" } as NonNullable<MenuResult["selectedAccount"]> });
  await openOfficialWalletMenu(api, menuOptions);
  assert.deepEqual(calls.map(call => call.name), ["menu"]);
});

test("navigation or a wallet switch cancels follow-up actions from an old menu", async () => {
  const inactive = menuFixture({ action: "deposit" });
  assert.equal(await openOfficialWalletMenu(inactive.api, { ...menuOptions, isCurrent: () => false }), null);
  assert.deepEqual(inactive.calls, []);
  let current = true;
  const { api, calls } = menuFixture({ action: "deposit" });
  const openMenu = api.openAccountMenu;
  api.openAccountMenu = async payload => { const result = await openMenu(payload); current = false; return result; };
  await openOfficialWalletMenu(api, { ...menuOptions, isCurrent: () => current });
  assert.deepEqual(calls.map(call => call.name), ["menu"]);
});

test("a scope change while preparing Add funds prevents opening a stale account's deposit screen", async () => {
  let current = true;
  const { api, calls } = menuFixture({ action: "deposit" });
  const ensure = api.ensureDepositAccount;
  api.ensureDepositAccount = async () => { const result = await ensure(); current = false; return result; };
  await openOfficialWalletMenu(api, { ...menuOptions, isCurrent: () => current });
  assert.deepEqual(calls.map(call => call.name), ["menu", "ensure"]);
});

test("a failed official menu request propagates an error without a fallback payout or local wallet", async () => {
  const { api, calls } = menuFixture({ action: "deposit" });
  api.openAccountMenu = async () => { throw new Error("Wallet unavailable"); };
  await assert.rejects(openOfficialWalletMenu(api, menuOptions), /Wallet unavailable/);
  assert.deepEqual(calls, []);
});
