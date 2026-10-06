import assert from "node:assert/strict";
import test from "node:test";
import { activeThruAddress, birthPresentation, noticeTone, type BirthStage } from "../apps/web/src/transaction-model.ts";
import { clearPendingBirth, loadPendingBirth, savePendingBirth } from "../apps/web/src/birth-receipts.ts";
import type { BirthTransactionResult } from "../packages/cambrian-sdk/src/transaction-service.ts";
import { copyPublicValue, faucetButtonPresentation, officialBalanceLabel, shortPublicAddress, type FaucetStage } from "../apps/web/src/presentation-model.ts";

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
