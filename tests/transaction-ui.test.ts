import assert from "node:assert/strict";
import test from "node:test";
import { activeThruAddress, birthPresentation, noticeTone, type BirthStage } from "../apps/web/src/transaction-model.ts";
import { clearPendingBirth, loadPendingBirth, savePendingBirth } from "../apps/web/src/birth-receipts.ts";
import type { BirthTransactionResult } from "../packages/cambrian-sdk/src/transaction-service.ts";

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
