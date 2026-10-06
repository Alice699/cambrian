import assert from "node:assert/strict";
import test from "node:test";
import { createThruClient, keys, Pubkey, Transaction, TransactionVmError, type Thru } from "@thru/sdk";
import { buildWalletAccountContext, encodeValidateInstruction, PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import type { ThruTransactionIntent } from "@thru/wallet";
import { defaultCambrianConfig } from "../packages/config/src/index.ts";
import { base64ToBytes, bytesToBase64 } from "../packages/cambrian-sdk/src/abi.ts";
import { prepareBirthIntent } from "../packages/cambrian-sdk/src/client.ts";
import {
  BirthExecutionError,
  BirthResourceBudgetError,
  confirmBirthTransaction,
  executeBirthTransaction,
  type BirthTransactionUpdate,
} from "../packages/cambrian-sdk/src/transaction-service.ts";

// Offline test signer only. No real wallet credentials or network writes.
const testPrivateKey = new Uint8Array(32).fill(0x11);
const feePayer = Pubkey.from(await keys.fromPrivateKey(testPrivateKey)).toThruFmt();
const selectedAccount = Pubkey.from(new Uint8Array(32).fill(0x22)).toThruFmt();
const config = { ...defaultCambrianConfig, walletBirthEnabled: true };
const fastPolling = { confirmationTimeoutMs: 0, organismTimeoutMs: 0, pollIntervalMs: 0 };
const birthOptions = { ...fastPolling, walletAddress: selectedAccount, signingMode: "thru-wallet" as const, seed: "birth-flow-test", entropy: new Uint8Array(32).fill(0x33) };

interface HarnessOptions {
  stream?: "confirmed" | "accepted" | "disconnect" | "disconnect-before-update" | "failed";
  status?: "confirmed" | "pending" | "unavailable" | "failed";
  missingAccountReads?: number;
  wrongOwner?: boolean;
  wrongMagic?: boolean;
  wrongController?: boolean;
  rejectApproval?: boolean;
  afterApproval?: () => void;
  afterSubmission?: () => void;
  signedStateUnits?: number;
  executionVmError?: number;
}

function harness(options: HarnessOptions = {}) {
  const sdk = createThruClient({ baseUrl: config.rpcUrl });
  const trace = {
    approvals: 0, submissions: 0, statusReads: 0, accountReads: 0,
    intents: [] as ThruTransactionIntent[],
    signedBytes: undefined as Uint8Array | undefined,
    submittedBytes: undefined as Uint8Array | undefined,
    signature: "",
    organismAddress: "",
    updates: [] as BirthTransactionUpdate[],
  };
  const execution = (vmError = 0) => ({
    vmError,
    userErrorCode: vmError && vmError !== TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED ? 9n : 0n,
  });
  const client = {
    ...sdk,
    proofs: { generate: async ({ address }: { address: string }) => {
      trace.organismAddress = address;
      return { proof: new Uint8Array([1, 2, 3]), slot: 120n };
    } },
    transactions: {
      sendAndTrack: async function* (raw: Uint8Array) {
        trace.submissions += 1;
        trace.submittedBytes = raw;
        options.afterSubmission?.();
        if (options.stream === "disconnect-before-update") throw new Error("RPC stream disconnected before acknowledging the signature");
        yield { status: 2, signature: { value: raw.slice(-64) } };
        if (options.stream === "disconnect") throw new Error("RPC stream disconnected");
        if (options.stream !== "accepted") {
          yield { status: 2, executionResult: execution(options.stream === "failed" ? options.executionVmError ?? 17 : 0) };
        }
      },
      getStatus: async (signature: string) => {
        assert.equal(signature, trace.signature);
        trace.statusReads += 1;
        if (options.status === "unavailable") throw new Error("Status index not ready");
        return { executionResult: options.status === "pending" ? undefined : execution(options.status === "failed" ? options.executionVmError ?? 17 : 0) };
      },
    },
    accounts: { get: async (address: string) => {
      assert.equal(address, trace.organismAddress);
      trace.accountReads += 1;
      if (trace.accountReads <= (options.missingAccountReads ?? 0)) throw new Error("Account index not ready");
      const data = new Uint8Array(264);
      const view = new DataView(data.buffer);
      view.setUint32(0, options.wrongMagic ? 0 : 0x43414d42, true);
      view.setUint8(4, 1);
      view.setUint8(5, 1);
      data.set(Pubkey.from(options.wrongController ? feePayer : selectedAccount).toBytes(), 8);
      view.setBigUint64(200, 123n, true);
      view.setBigUint64(208, 123n, true);
      view.setBigUint64(224, 100n, true);
      view.setBigUint64(232, 100n, true);
      return {
        address: Pubkey.from(address),
        meta: { owner: Pubkey.from(options.wrongOwner ? selectedAccount : config.programId), dataSize: data.length, balance: 0n, nonce: 0n, seq: 1n },
        data: { data, compressed: false },
      };
    } },
  } as unknown as Thru;
  const wallet = {
    connected: true,
    signTransaction: async (intent: ThruTransactionIntent) => {
      trace.approvals += 1;
      trace.intents.push(intent);
      if (options.rejectApproval) throw new Error("User rejected transaction approval");
      // Mirror the actual managed-wallet wrapper and account order. Authentication
      // values are fixtures: these tests do not replace live WebAuthn approval.
      const context = buildWalletAccountContext({
        walletAddress: intent.walletAddress!,
        readWriteAccounts: (intent.readWriteAddresses ?? []).map(address => Pubkey.from(address).toBytes()),
        readOnlyAccounts: (intent.readOnlyAddresses ?? []).map(address => Pubkey.from(address).toBytes()),
      });
      const instructionData = encodeValidateInstruction({
        walletAccountIdx: context.walletAccountIdx,
        authIdx: 0,
        targetInstruction: {
          programIdx: context.getAccountIndex(Pubkey.from(intent.programAddress).toBytes()),
          instructionData: base64ToBytes(intent.instructionData),
        },
        signatureR: new Uint8Array(32).fill(1),
        signatureS: new Uint8Array(32).fill(2),
        authenticatorData: new Uint8Array(37),
        clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get","origin":"https://test.invalid"}'),
      });
      const transaction = new Transaction({
        feePayer, program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
        header: { fee: 1n, nonce: 2n, startSlot: 120n, stateUnits: options.signedStateUnits ?? intent.stateUnits ?? 0 },
        accounts: { readWriteAccounts: intent.readWriteAddresses, readOnlyAccounts: intent.readOnlyAddresses },
        instructionData,
      });
      await transaction.sign(testPrivateKey);
      trace.signedBytes = transaction.toWire();
      trace.signature = transaction.getSignature()!.toThruFmt();
      options.afterApproval?.();
      return bytesToBase64(trace.signedBytes);
    },
  };
  const onUpdate = (update: BirthTransactionUpdate) => trace.updates.push(update);
  return { client, wallet, trace, onUpdate };
}

test("Birth approves the selected Thru account, submits the exact wallet bytes, and reads the created organism", async () => {
  const { client, wallet, trace, onUpdate } = harness();
  const result = await executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate });

  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 1);
  assert.deepEqual(trace.submittedBytes, trace.signedBytes);
  assert.equal(trace.intents[0].walletAddress, selectedAccount);
  assert.equal(trace.intents[0].stateUnits, 1);
  const transaction = Transaction.fromWire(trace.submittedBytes!);
  assert.notEqual(transaction.feePayer.toThruFmt(), selectedAccount);
  assert.equal(transaction.program.toThruFmt(), PASSKEY_MANAGER_PROGRAM_ADDRESS);
  assert.equal(transaction.requestedStateUnits, 1);
  const accounts = [transaction.feePayer, transaction.program, ...transaction.readWriteAccounts, ...transaction.readOnlyAccounts].map(key => key.toThruFmt());
  const bytes = base64ToBytes(trace.intents[0].instructionData);
  const organismIndex = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, true);
  const controllerIndex = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(3, true);
  assert.equal(bytes[0], 5);
  assert.equal(trace.intents[0].review?.instruction, "wallet_birth");
  assert.equal(accounts[controllerIndex], selectedAccount);
  assert.notEqual(accounts[controllerIndex], transaction.feePayer.toThruFmt());
  assert.equal(accounts[organismIndex], result.prepared.organismAddress);
  assert.notEqual(accounts[organismIndex], selectedAccount);
  assert.ok(trace.intents[0].readWriteAddresses?.includes(result.prepared.organismAddress));
  assert.equal(result.stage, "confirmed");
  assert.equal(result.signature, trace.signature);
  assert.equal(result.organism?.address, result.prepared.organismAddress);
  assert.equal(result.organism?.owner, config.programId);
  assert.equal(result.slot, 123n);
  assert.equal(result.organism?.state.energy, 100n);
  assert.deepEqual(trace.updates.map((update) => update.stage), [
    "preparing", "awaiting-approval", "signed", "submitting", "submitted", "syncing", "confirmed",
  ]);
  assert.equal(trace.statusReads, 0);
  assert.equal(trace.updates.find(update => update.stage === "submitting")?.signature, result.signature);
});

test("regression: the live failed wallet layout targets organism index 3, not the existing wallet at index 2", async () => {
  const walletAddress = "taPGuB7kndMDyU0aM1X8Wr-LDpFY-hsA3R119RgVLlU6VP";
  const organismAddress = "ta_MVFHHWGUS-xhCekygGhSZzczDvCOmUsE2swwelWj7tW";
  const sdk = createThruClient({ baseUrl: config.rpcUrl });
  const client = {
    ...sdk,
    helpers: { ...sdk.helpers, deriveProgramAddress: () => ({ address: organismAddress }) },
    proofs: { generate: async () => ({ proof: new Uint8Array([1, 2, 3]), slot: 1n }) },
  } as unknown as Thru;
  const prepared = await prepareBirthIntent(client, config, { ...birthOptions, walletAddress });
  const bytes = base64ToBytes(prepared.intent.instructionData);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, true), 3);
  assert.deepEqual(prepared.intent.readWriteAddresses, [walletAddress, organismAddress]);
  assert.deepEqual(prepared.intent.readOnlyAddresses, [config.programId]);
  assert.equal(prepared.intent.stateUnits, 1);
});

test("regression: a wallet signing the live failed zero-state-unit header never submits Birth", async () => {
  const { client, wallet, trace, onUpdate } = harness({ signedStateUnits: 0 });
  await assert.rejects(() => executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate }), (error) => {
    assert.ok(error instanceof BirthResourceBudgetError);
    assert.equal(error.requestedStateUnits, 0);
    assert.equal(error.requiredStateUnits, 1);
    assert.match(error.message, /Nothing was submitted/);
    return true;
  });
  assert.equal(trace.intents[0].stateUnits, 1);
  assert.equal(Transaction.fromWire(trace.signedBytes!).requestedStateUnits, 0);
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 0);
  assert.equal(trace.statusReads, 0);
  assert.equal(trace.accountReads, 0);
  assert.equal(trace.updates.at(-1)?.stage, "failed");
  assert.equal(trace.updates.at(-1)?.signature, undefined);
});

test("a wallet's sufficient state budget and signed bytes are preserved without rewriting", async () => {
  const { client, wallet, trace } = harness({ signedStateUnits: 2 });
  const result = await executeBirthTransaction(client, config, wallet, birthOptions);
  assert.equal(result.stage, "confirmed");
  assert.equal(Transaction.fromWire(trace.submittedBytes!).requestedStateUnits, 2);
  assert.deepEqual(trace.submittedBytes, trace.signedBytes);
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 1);
});

for (const source of ["stream", "status"] as const) {
  test(`state-unit exhaustion from ${source} keeps the failed signature and explains resource limits`, async () => {
    const { client, wallet, trace, onUpdate } = harness({
      stream: source === "stream" ? "failed" : "disconnect",
      status: "failed",
      executionVmError: TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED,
    });
    await assert.rejects(() => executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate }), (error) => {
      assert.ok(error instanceof BirthExecutionError);
      assert.equal(error.vmError, -763);
      assert.equal(error.userErrorCode, 0n);
      assert.equal(error.signature, trace.signature);
      assert.match(error.message, /ran out of state units/);
      return true;
    });
    assert.equal(trace.approvals, 1);
    assert.equal(trace.submissions, 1);
    assert.equal(trace.accountReads, 0);
    assert.equal(trace.updates.at(-1)?.stage, "failed");
    assert.equal(trace.updates.some(update => update.stage === "confirmed"), false);
  });
}

test("managed Birth indices follow byte sorting rather than always choosing index 3", async () => {
  const sdk = createThruClient({ baseUrl: config.rpcUrl });
  const organismAddress = Pubkey.from(new Uint8Array(32).fill(1)).toThruFmt();
  const walletAddress = Pubkey.from(new Uint8Array(32).fill(254)).toThruFmt();
  const client = {
    ...sdk,
    helpers: { ...sdk.helpers, deriveProgramAddress: () => ({ address: organismAddress }) },
    proofs: { generate: async () => ({ proof: new Uint8Array([1]), slot: 1n }) },
  } as unknown as Thru;
  const prepared = await prepareBirthIntent(client, config, { ...birthOptions, walletAddress });
  const bytes = base64ToBytes(prepared.intent.instructionData);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, true), 2);
  assert.deepEqual(prepared.intent.readWriteAddresses, [organismAddress, walletAddress]);
});

test("legacy direct Birth retains its original account layout without a passkey wrapper", async () => {
  const { client } = harness();
  const prepared = await prepareBirthIntent(client, config, { ...birthOptions, signingMode: "direct" });
  const bytes = base64ToBytes(prepared.intent.instructionData);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, true), 2);
  assert.deepEqual(prepared.intent.readWriteAddresses, [prepared.organismAddress]);
  assert.equal(prepared.intent.readOnlyAddresses, undefined);
});

test("rejected Thru Wallet approval does not submit or report success", async () => {
  const { client, wallet, trace, onUpdate } = harness({ rejectApproval: true });
  await assert.rejects(() => executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate }), /User rejected/);
  assert.equal(trace.submissions, 0);
  assert.equal(trace.accountReads, 0);
  assert.equal(trace.updates.at(-1)?.stage, "failed");
  assert.equal(trace.updates.some((update) => update.stage === "confirmed"), false);
});

test("VM execution failure preserves its signature and error codes without reading an organism", async () => {
  const { client, wallet, trace, onUpdate } = harness({ stream: "failed" });
  await assert.rejects(() => executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate }), (error) => {
    assert.ok(error instanceof BirthExecutionError);
    assert.equal(error.signature, trace.signature);
    assert.equal(error.vmError, 17);
    assert.equal(error.userErrorCode, 9n);
    return true;
  });
  assert.equal(trace.accountReads, 0);
  assert.equal(trace.updates.filter((update) => update.stage === "failed").length, 1);
});

test("a dropped response stream is reconciled with status reads, never a second send", async () => {
  const { client, wallet, trace, onUpdate } = harness({ stream: "disconnect", status: "confirmed" });
  const result = await executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate });
  assert.equal(result.stage, "confirmed");
  assert.ok(result.organism);
  assert.equal(trace.statusReads, 1);
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 1);
});

test("accepted is not confirmed; checking a pending Birth is read-only", async () => {
  const options: HarnessOptions = { stream: "accepted", status: "pending" };
  const { client, wallet, trace, onUpdate } = harness(options);
  const pending = await executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate });
  assert.equal(pending.stage, "submitted");
  assert.equal(pending.organism, undefined);
  assert.equal(trace.accountReads, 0);
  assert.equal(trace.updates.some((update) => update.stage === "confirmed"), false);

  options.status = "confirmed";
  const confirmed = await confirmBirthTransaction(client, config, pending, { ...fastPolling, onUpdate });
  assert.ok(confirmed.organism);
  assert.equal(confirmed.signature, pending.signature);
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 1);
});

test("a missing status entry remains pending rather than showing a false error or success", async () => {
  const { client, wallet, trace, onUpdate } = harness({ stream: "disconnect", status: "unavailable" });
  const result = await executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate });
  assert.equal(result.stage, "submitted");
  assert.equal(result.signature, trace.signature);
  assert.equal(trace.submissions, 1);
  assert.equal(trace.updates.some((update) => ["failed", "confirmed"].includes(update.stage)), false);
});

test("confirmed execution waits for readable organism data before showing completed Birth", async () => {
  const { client, wallet, trace, onUpdate } = harness({ missingAccountReads: 1 });
  const receipt = await executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate });
  assert.equal(receipt.stage, "confirmed");
  assert.equal(receipt.organism, undefined);
  assert.equal(trace.updates.at(-1)?.stage, "syncing");

  const result = await confirmBirthTransaction(client, config, receipt, { ...fastPolling, onUpdate });
  assert.equal(result.organism?.address, receipt.prepared.organismAddress);
  assert.equal(trace.updates.at(-1)?.stage, "confirmed");
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 1);
});

test("organism polling tolerates transient account indexing delays", async () => {
  const { client, wallet, trace, onUpdate } = harness({ missingAccountReads: 2 });
  const result = await executeBirthTransaction(client, config, wallet, { ...birthOptions, organismTimeoutMs: 500, onUpdate });
  assert.ok(result.organism);
  assert.equal(trace.accountReads, 3);
  assert.equal(trace.submissions, 1);
});

for (const invalid of ["wrongOwner", "wrongMagic", "wrongController"] as const) {
  test(`does not display an unrelated or invalid organism account (${invalid})`, async () => {
    const { client, wallet, trace, onUpdate } = harness({ [invalid]: true });
    const result = await executeBirthTransaction(client, config, wallet, { ...birthOptions, onUpdate });
    assert.equal(result.organism, undefined);
    assert.equal(trace.updates.some((update) => update.stage === "confirmed"), false);
  });
}

test("cancellation after wallet approval does not submit the signed transaction", async () => {
  const controller = new AbortController();
  const { client, wallet, trace } = harness({ afterApproval: () => controller.abort() });
  await assert.rejects(() => executeBirthTransaction(client, config, wallet, { ...birthOptions, signal: controller.signal }), { name: "AbortError" });
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 0);
});

test("a wallet switch during a silent submission retains its public receipt for read-only recovery", async () => {
  const controller = new AbortController();
  const { client, wallet, trace, onUpdate } = harness({ stream: "disconnect-before-update", afterSubmission: () => controller.abort() });
  let firstSignature: string | undefined;
  const receipt = await executeBirthTransaction(client, config, wallet, { ...birthOptions, signal: controller.signal, onUpdate(update) {
    if (update.stage === "submitting") {
      assert.equal(trace.submissions, 0);
      firstSignature = update.signature;
    }
    onUpdate(update);
  } });
  assert.ok(firstSignature);
  assert.equal(receipt.signature, firstSignature);
  assert.equal(receipt.stage, "submitted");
  assert.equal(trace.statusReads, 0);
  assert.equal(trace.accountReads, 0);
  const recovered = await confirmBirthTransaction(client, config, receipt, fastPolling);
  assert.equal(recovered.organism?.address, receipt.prepared.organismAddress);
  assert.equal(trace.approvals, 1);
  assert.equal(trace.submissions, 1);
});

test("a disconnected wallet cannot sign Birth", async () => {
  const { client, wallet, trace } = harness();
  wallet.connected = false;
  await assert.rejects(() => executeBirthTransaction(client, config, wallet, birthOptions), /Wallet must be connected/);
  assert.equal(trace.approvals, 0);
  assert.equal(trace.submissions, 0);
});
