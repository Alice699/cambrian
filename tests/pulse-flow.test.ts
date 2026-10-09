import assert from "node:assert/strict";
import test from "node:test";
import { createThruClient, keys, Pubkey, Transaction, type Thru } from "@thru/sdk";
import { buildWalletAccountContext, encodeValidateInstruction, PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import type { ThruTransactionIntent } from "@thru/wallet";
import { defaultCambrianConfig as config } from "../packages/config/src/index.ts";
import { base64ToBytes, bytesToBase64, encodePulseInstruction } from "../packages/cambrian-sdk/src/abi.ts";
import { executePulseTransaction, preparePulseIntent, confirmPulseTransaction, PulseExecutionError, type PulseTransactionUpdate } from "../packages/cambrian-sdk/src/pulse-service.ts";
import { identifyAccountTransaction } from "../packages/cambrian-sdk/src/activity.ts";
import { savePendingPulse, loadPendingPulse, clearPendingPulse } from "../apps/web/src/pulse-receipts.ts";

// Synthetic offline signer only. Never used with the real wallet or RPC.
const privateKey = new Uint8Array(32).fill(0x11);
const feePayer = Pubkey.from(await keys.fromPrivateKey(privateKey)).toThruFmt();
const selectedAccount = Pubkey.from(new Uint8Array(32).fill(0x44)).toThruFmt();
const otherWallet = Pubkey.from(new Uint8Array(32).fill(0x55)).toThruFmt();
const organismAddress = Pubkey.from(new Uint8Array(32).fill(0x66)).toThruFmt();
const fast = { confirmationTimeoutMs: 0, organismTimeoutMs: 0, pollIntervalMs: 0 };
const pulseOptions = { ...fast, walletAddress: selectedAccount, organismAddress, catalyst: 0xf123456789abcdefn };

interface Options {
  stream?: "accepted" | "disconnect" | "failed";
  status?: "pending" | "unavailable" | "failed";
  dead?: boolean; wrongOwner?: boolean; wrongController?: boolean; wrongMagic?: boolean;
  slot?: bigint; ready?: boolean; reject?: boolean;
  stale?: boolean; unreadable?: boolean; wrongResultOwner?: boolean; wrongResultController?: boolean;
  afterApproval?: () => void; afterSubmission?: () => void;
  changed?: boolean;
}

function harness(options: Options = {}) {
  const sdk = createThruClient({ baseUrl: config.rpcUrl });
  const trace = { approvals: 0, submissions: 0, reads: 0, statusReads: 0,
    updates: [] as PulseTransactionUpdate[], intents: [] as ThruTransactionIntent[],
    signed: undefined as Uint8Array | undefined, submitted: undefined as Uint8Array | undefined, signature: "" };
  const execution = (failed = false) => ({ vmError: failed ? -765 : 0, userErrorCode: failed ? 0xca010010n : 0n });
  const client = {
    ...sdk,
    node: { getStatus: async () => ({ ready: options.ready ?? true, locallyExecutedSlot: options.slot ?? 125n }) },
    accounts: { get: async (address: string) => {
      assert.equal(address, organismAddress);
      trace.reads++;
      const after = trace.submissions > 0;
      if (after && options.unreadable) throw new Error("Index unavailable");
      const data = new Uint8Array(264); const view = new DataView(data.buffer);
      view.setUint32(0, options.wrongMagic ? 0 : 0x43414d42, true);
      view.setUint8(4, 1); view.setUint8(5, options.dead ? 3 : 1);
      data.set(Pubkey.from(options.wrongController || (after && options.wrongResultController) ? otherWallet : selectedAccount).toBytes(), 8);
      view.setBigUint64(200, 100n, true);
      view.setBigUint64(208, options.changed || (after && !options.stale) ? 125n : 123n, true);
      view.setBigUint64(224, after && !options.stale ? 2030n : 2048n, true);
      view.setBigUint64(232, after && !options.stale ? 769n : 768n, true);
      view.setBigUint64(240, options.changed || (after && !options.stale) ? 1n : 0n, true);
      return { address: Pubkey.from(address), meta: { owner: Pubkey.from(options.wrongOwner || (after && options.wrongResultOwner) ? otherWallet : config.programId), dataSize: 264, seq: 1n }, data: { data, compressed: false } };
    } },
    transactions: {
      sendAndTrack: async function* (raw: Uint8Array) {
        trace.submissions++; trace.submitted = raw; options.afterSubmission?.();
        if (options.stream === "disconnect") throw new Error("Disconnected response stream");
        yield { status: 2 };
        if (options.stream !== "accepted") yield { executionResult: execution(options.stream === "failed") };
      },
      getStatus: async (signature: string) => {
        assert.equal(signature, trace.signature); trace.statusReads++;
        if (options.status === "unavailable") throw new Error("Index unavailable");
        return { executionResult: options.status === "pending" ? undefined : execution(options.status === "failed") };
      },
    },
  } as unknown as Thru;
  const wallet = { connected: true, signTransaction: async (intent: ThruTransactionIntent) => {
    trace.approvals++; trace.intents.push(intent);
    if (options.reject) throw new Error("User rejected Pulse approval");
    const context = buildWalletAccountContext({ walletAddress: intent.walletAddress!,
      readWriteAccounts: intent.readWriteAddresses!.map(value => Pubkey.from(value).toBytes()), readOnlyAccounts: intent.readOnlyAddresses!.map(value => Pubkey.from(value).toBytes()) });
    const transaction = new Transaction({ feePayer, program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
      header: { fee: 1n, nonce: 2n, startSlot: 125n, stateUnits: intent.stateUnits },
      accounts: { readWriteAccounts: intent.readWriteAddresses, readOnlyAccounts: intent.readOnlyAddresses },
      instructionData: encodeValidateInstruction({ walletAccountIdx: context.walletAccountIdx, authIdx: 0,
        targetInstruction: { programIdx: context.getAccountIndex(Pubkey.from(config.programId).toBytes()), instructionData: base64ToBytes(intent.instructionData) },
        signatureR: new Uint8Array(32).fill(1), signatureS: new Uint8Array(32).fill(2), authenticatorData: new Uint8Array(37),
        clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get","origin":"https://test.invalid"}') }),
    });
    await transaction.sign(privateKey);
    trace.signed = transaction.toWire(); trace.signature = transaction.getSignature()!.toThruFmt();
    options.afterApproval?.();
    return bytesToBase64(trace.signed);
  } };
  return { client, wallet, trace, onUpdate: (update: PulseTransactionUpdate) => trace.updates.push(update) };
}

test("Pulse wire format is exactly tag 1 + little-endian u16 + full-precision u64", () => {
  const bytes = encodePulseInstruction(0x1234, 0xf123456789abcdefn);
  assert.deepEqual(Array.from(bytes), [1, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0xf1]);
  for (const idx of [0, 1, -1, 0x10000, 2.1]) assert.throws(() => encodePulseInstruction(idx, 0n));
  for (const value of [-1n, 0x10000000000000000n, 12 as unknown as bigint]) assert.throws(() => encodePulseInstruction(2, value));
  assert.doesNotThrow(() => encodePulseInstruction(2, 0xffff_ffff_ffff_ffffn));
});

test("Pulse uses the managed wrapper's sorted organism index, not a hard-coded account 2", async () => {
  const { client } = harness();
  const prepared = await preparePulseIntent(client, config, pulseOptions);
  const accounts = [feePayer, PASSKEY_MANAGER_PROGRAM_ADDRESS, ...prepared.intent.readWriteAddresses!, ...prepared.intent.readOnlyAddresses!];
  const bytes = base64ToBytes(prepared.intent.instructionData);
  assert.equal(accounts[new DataView(bytes.buffer).getUint16(1, true)], organismAddress);
  assert.deepEqual(prepared.intent.readWriteAddresses, [selectedAccount, organismAddress]);
  assert.equal(prepared.intent.review?.instruction, "pulse");
  assert.equal(prepared.intent.review?.abiName, "cambrian.lifeform.CambrianInstruction");
  assert.equal(prepared.intent.stateUnits, 0);
});

test("Pulse approves once, submits the exact canonical bytes once and verifies updated traits", async () => {
  const { client, wallet, trace, onUpdate } = harness();
  const result = await executePulseTransaction(client, config, wallet, { ...pulseOptions, onUpdate });
  assert.equal(trace.approvals, 1); assert.equal(trace.submissions, 1);
  assert.deepEqual(trace.submitted, trace.signed);
  assert.equal(result.signature, trace.signature); assert.equal(result.stage, "confirmed");
  assert.equal(result.organism?.state.energy, 2030n); assert.equal(result.organism?.state.vitality, 769n); assert.equal(result.organism?.state.pulseCount, 1n);
  assert.deepEqual(trace.updates.map(value => value.stage), ["preparing", "awaiting-approval", "signed", "submitting", "submitted", "syncing", "confirmed"]);
  assert.equal(trace.updates.find(value => value.stage === "submitting")?.receipt?.signature, trace.signature);
  const transaction = Transaction.fromWire(trace.submitted!);
  const activity = identifyAccountTransaction(transaction, { walletAddress: selectedAccount, cambrianProgramId: config.programId, confirmed: true });
  assert.equal(activity.kind, "pulse"); assert.equal(activity.cambrianActionCount, 1);
});

for (const [label, options, message] of [
  ["wallet B ownership", { wrongController: true }, /controller/],
  ["another program", { wrongOwner: true }, /Cambrian program/],
  ["dead organism", { dead: true }, /dead/],
  ["invalid header", { wrongMagic: true }, /magic/],
  ["same slot", { slot: 123n }, /newer network slot/],
  ["expired window", { slot: 4220n }, /window expired/],
  ["unready node", { ready: false }, /unavailable/],
] as const) {
  test(`${label} is blocked before any Pulse approval or submission`, async () => {
    const { client, wallet, trace } = harness(options);
    await assert.rejects(() => executePulseTransaction(client, config, wallet, pulseOptions), message);
    assert.equal(trace.approvals, 0); assert.equal(trace.submissions, 0);
  });
}

test("the 4,096-slot boundary is inclusive and invalid catalyst is rejected before RPC", async () => {
  const { client } = harness({ slot: 4219n });
  assert.ok(await preparePulseIntent(client, config, pulseOptions));
  const bad = harness();
  await assert.rejects(() => preparePulseIntent(bad.client, config, { ...pulseOptions, catalyst: -1n }), /catalyst/);
  assert.equal(bad.trace.reads, 0);
});

test("rejected approval, wallet cancellation and changed approval-time state never send Pulse", async () => {
  const rejected = harness({ reject: true });
  await assert.rejects(() => executePulseTransaction(rejected.client, config, rejected.wallet, pulseOptions), /User rejected/);
  assert.equal(rejected.trace.submissions, 0);
  const controller = new AbortController();
  const cancelled = harness({ afterApproval: () => controller.abort() });
  await assert.rejects(() => executePulseTransaction(cancelled.client, config, cancelled.wallet, { ...pulseOptions, signal: controller.signal }), /aborted/);
  assert.equal(cancelled.trace.submissions, 0);
  const options: Options = {}; options.afterApproval = () => { options.changed = true; options.slot = 126n; };
  const changed = harness(options);
  await assert.rejects(() => executePulseTransaction(changed.client, config, changed.wallet, pulseOptions), /changed during approval/);
  assert.equal(changed.trace.submissions, 0);
});

test("expiry during wallet approval stops the already-signed transaction before broadcast", async () => {
  const options: Options = {}; options.afterApproval = () => { options.slot = 5000n; };
  const { client, wallet, trace } = harness(options);
  await assert.rejects(() => executePulseTransaction(client, config, wallet, pulseOptions), /Nothing was submitted/);
  assert.equal(trace.approvals, 1); assert.equal(trace.submissions, 0);
});

test("cancellation at the approval transition never opens a signing request", async () => {
  const controller = new AbortController(); const { client, wallet, trace } = harness();
  await assert.rejects(() => executePulseTransaction(client, config, wallet, { ...pulseOptions, signal: controller.signal,
    onUpdate: update => { if (update.stage === "awaiting-approval") controller.abort(); } }), /aborted/);
  assert.equal(trace.approvals, 0); assert.equal(trace.submissions, 0);
});

test("cancellation at broadcast keeps the public receipt without opening a send stream", async () => {
  const controller = new AbortController(); const { client, wallet, trace } = harness();
  const result = await executePulseTransaction(client, config, wallet, { ...pulseOptions, signal: controller.signal,
    onUpdate: update => { if (update.stage === "submitting") controller.abort(); } });
  assert.equal(result.signature, trace.signature); assert.equal(result.stage, "submitted");
  assert.equal(trace.submissions, 0); assert.equal(trace.statusReads, 0);
});

test("pending and missing execution remain yellow; a later check reads without a second approval or send", async () => {
  const options: Options = { stream: "accepted", status: "pending" };
  const { client, wallet, trace, onUpdate } = harness(options);
  const pending = await executePulseTransaction(client, config, wallet, { ...pulseOptions, onUpdate });
  assert.equal(pending.stage, "submitted"); assert.equal(pending.organism, undefined);
  assert.equal(trace.reads, 2); assert.equal(trace.updates.some(value => value.stage === "confirmed"), false);
  options.status = undefined;
  const result = await confirmPulseTransaction(client, config, pending, { ...fast, onUpdate });
  assert.equal(result.organism?.state.pulseCount, 1n);
  assert.equal(trace.approvals, 1); assert.equal(trace.submissions, 1);
});

for (const key of ["stale", "unreadable", "wrongResultOwner", "wrongResultController"] as const) {
  test(`confirmed Pulse with ${key} state stays syncing, never completed`, async () => {
    const options: Options = { [key]: true };
    const { client, wallet, trace, onUpdate } = harness(options);
    const receipt = await executePulseTransaction(client, config, wallet, { ...pulseOptions, onUpdate });
    assert.equal(receipt.stage, "confirmed"); assert.equal(receipt.organism, undefined);
    assert.equal(trace.updates.at(-1)?.stage, "syncing");
    options[key] = false;
    assert.ok((await confirmPulseTransaction(client, config, receipt, fast)).organism);
    assert.equal(trace.submissions, 1);
  });
}

test("a dropped stream reconciles the same signature, and unknown status never becomes failure", async () => {
  for (const status of [undefined, "unavailable"] as const) {
    const { client, wallet, trace, onUpdate } = harness({ stream: "disconnect", status });
    const result = await executePulseTransaction(client, config, wallet, { ...pulseOptions, onUpdate });
    assert.equal(result.stage, status ? "submitted" : "confirmed");
    assert.equal(trace.submissions, 1); assert.equal(trace.statusReads, 1);
    assert.equal(trace.updates.some(value => value.stage === "failed"), false);
  }
});

test("failed stream and read-only execution results preserve the signature and program error", async () => {
  for (const source of ["stream", "status"]) {
    const { client, wallet, trace, onUpdate } = harness({ stream: source === "stream" ? "failed" : "accepted", status: "failed" });
    await assert.rejects(() => executePulseTransaction(client, config, wallet, { ...pulseOptions, onUpdate }), error => {
      assert.ok(error instanceof PulseExecutionError);
      assert.equal(error.signature, trace.signature); assert.equal(error.userErrorCode, 0xca010010n);
      assert.match(error.message, /slot window/); return true;
    });
    assert.equal(trace.reads, 2); assert.equal(trace.updates.at(-1)?.stage, "failed");
    assert.equal(trace.updates.at(-1)?.signature, trace.signature);
    assert.equal(trace.updates.some(value => value.stage === "confirmed"), false);
  }
});

test("cancellation during submission retains the receipt and never sends again", async () => {
  const controller = new AbortController();
  const { client, wallet, trace, onUpdate } = harness({ stream: "disconnect", afterSubmission: () => controller.abort() });
  const result = await executePulseTransaction(client, config, wallet, { ...pulseOptions, onUpdate, signal: controller.signal });
  assert.equal(result.stage, "submitted"); assert.equal(result.signature, trace.signature);
  assert.equal(trace.submissions, 1); assert.equal(trace.statusReads, 0);
  assert.equal(trace.updates.find(value => value.stage === "submitting")?.receipt?.signature, trace.signature);
});

test("only public receipt fields survive refresh, with wallet/program/RPC isolation", async () => {
  const { client, wallet } = harness({ stream: "accepted", status: "pending" });
  const receipt = await executePulseTransaction(client, config, wallet, pulseOptions);
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
  savePendingPulse(storage, config, selectedAccount, { ...receipt, intent: { secret: "must not persist" }, signedTransaction: "must not persist" } as typeof receipt);
  assert.equal(loadPendingPulse(storage, config, selectedAccount)?.signature, receipt.signature);
  assert.equal(loadPendingPulse(storage, config, otherWallet), null);
  assert.equal(loadPendingPulse(storage, { ...config, rpcUrl: "https://other.invalid" }, selectedAccount), null);
  assert.equal(loadPendingPulse(storage, { ...config, programId: otherWallet }, selectedAccount), null);
  assert.doesNotMatch([...records.values()][0], /intent|secret|signedTransaction|authenticator|clientData/);
  const key = [...records.keys()][0]; const parsed = JSON.parse(records.get(key)!);
  for (const changed of [{ walletAddress: otherWallet }, { baselinePulseCount: "-1" }, { lastPulseSlot: "18446744073709551616" }, { signature: "bad" }]) {
    records.set(key, JSON.stringify({ ...parsed, ...changed })); assert.equal(loadPendingPulse(storage, config, selectedAccount), null);
  }
  records.set(key, JSON.stringify(parsed)); clearPendingPulse(storage, config, selectedAccount); assert.equal(records.size, 0);
});
