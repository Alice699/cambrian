import assert from "node:assert/strict";
import test from "node:test";
import { Pubkey, TransactionView, type Thru, type Transaction } from "@thru/sdk";
import { buildMulticallInstruction, MULTICALL_PROGRAM_ADDRESS } from "@thru/programs/multicall";
import { encodeTransferInstruction, PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import { identifyAccountTransaction, summarizeAccountActivity } from "../packages/cambrian-sdk/src/activity.ts";
import { listAccountTransactions } from "../packages/cambrian-sdk/src/read-service.ts";
import { defaultCambrianConfig as config } from "../packages/config/src/index.ts";
import { makeWalletSetupTransaction, makeWalletBirthTransaction, walletBAddress, walletBSetupSignature } from "./fixtures/activity-transactions.ts";

const options = { walletAddress: walletBAddress, cambrianProgramId: config.programId, confirmed: true };
const identify = (transaction: Transaction, extra: Partial<typeof options> = {}) => identifyAccountTransaction(transaction, { ...options, ...extra });
const summary = (transaction: Transaction) => ({ status: transaction.executionResult ? transaction.executionResult.vmError === 0 ? "confirmed" as const : "failed" as const : "pending" as const,
  activity: identify(transaction, { confirmed: transaction.executionResult?.vmError === 0 }) });

test("wallet B setup combines create and credential registration into one labeled wallet transaction, not a Cambrian action", () => {
  const transaction = makeWalletSetupTransaction();
  const activity = identify(transaction);
  assert.equal(activity.kind, "wallet-create");
  assert.equal(activity.label, "Wallet created");
  assert.equal(activity.description, "Account creation · Passkey registration");
  assert.equal(activity.category, "wallet");
  assert.deepEqual(summarizeAccountActivity([summary(transaction)]), { walletTransactions: 1, confirmedCambrianActions: 0, incompleteConfirmedDetails: false });
});

test("failed and pending setup never claim the wallet was created", () => {
  for (const vmError of [-763, undefined]) {
    const transaction = makeWalletSetupTransaction();
    transaction.executionResult = vmError === undefined ? undefined : { vmError, userErrorCode: 0n } as Transaction["executionResult"];
    assert.equal(summary(transaction).activity.label, "Wallet creation");
    assert.equal(summarizeAccountActivity([summary(transaction)]).confirmedCambrianActions, 0);
  }
});

test("managed-wallet authorization is decoded to its actual Cambrian target, not counted as a second action", () => {
  const transaction = makeWalletBirthTransaction(walletBAddress);
  assert.equal(identify(transaction).kind, "birth");
  assert.equal(identify(transaction).category, "cambrian");
  assert.equal(identify(transaction).label, "Organism birth");
  assert.equal(summarizeAccountActivity([summary(transaction)]).confirmedCambrianActions, 1);
});

test("failed and pending Cambrian requests stay in wallet history but not the confirmed action count", () => {
  const confirmed = makeWalletBirthTransaction(walletBAddress);
  const failed = makeWalletBirthTransaction(walletBAddress, -763);
  const pending = makeWalletBirthTransaction(walletBAddress);
  pending.executionResult = undefined;
  assert.deepEqual(summarizeAccountActivity([summary(confirmed), summary(failed), summary(pending)]), {
    walletTransactions: 3, confirmedCambrianActions: 1, incompleteConfirmedDetails: false,
  });
});

test("a Cambrian readonly account alone is never treated as a Cambrian invocation", () => {
  const transaction = makeWalletSetupTransaction();
  transaction.readOnlyAccounts.push(Pubkey.from(config.programId));
  assert.equal(identify(transaction).kind, "wallet-create");
  assert.equal(identify(transaction).cambrianActionCount, 0);
  assert.equal(identify(transaction, { cambrianProgramId: "another-program" }).cambrianActionCount, 0);
  assert.equal(identify(makeWalletBirthTransaction(walletBAddress), { cambrianProgramId: "another-program" }).category, "network");
});

test("wallet creation for a different account does not acquire a Wallet created label", () => {
  assert.equal(identify(makeWalletSetupTransaction(), { walletAddress: config.programId }).category, "unknown");
});

test("native wallet transfers are identified without claiming they came from a faucet", () => {
  const base = makeWalletBirthTransaction(walletBAddress);
  const transfer = { ...base, instructionData: encodeTransferInstruction({ walletAccountIdx: 2, toAccountIdx: 3, amount: 100n }) } as Transaction;
  const activity = identify(transfer);
  assert.equal(activity.kind, "wallet-transfer");
  assert.equal(activity.cambrianActionCount, 0);
  assert.doesNotMatch(activity.label + activity.description, /faucet/i);
});

test("proof-sized and fixed-size Cambrian instructions are classified without byte-prefix guessing", () => {
  const base = makeWalletBirthTransaction(walletBAddress);
  for (const [tag, length, kind] of [[1, 11, "pulse"], [2, 13, "encounter"], [4, 5, "transfer-control"]] as const) {
    const data = new Uint8Array(length); data[0] = tag;
    const direct = { ...base, program: Pubkey.from(config.programId), instructionData: data } as Transaction;
    assert.equal(identify(direct).kind, kind);
    assert.equal(identify({ ...direct, instructionData: data.slice(0, -1) } as Transaction).category, "unknown");
  }
  assert.equal(identify({ ...base, program: Pubkey.from(config.programId), instructionData: new Uint8Array([5]) } as Transaction).category, "unknown");
});

test("malformed batches and invalid target indices fail closed without hiding their receipt", () => {
  const base = makeWalletSetupTransaction();
  for (const data of [base.instructionData!.slice(0, -1), buildMulticallInstruction([{ programIdx: 65000, instructionData: new Uint8Array([0, 3, 0]) }])]) {
    assert.equal(identify({ ...base, instructionData: data } as Transaction).kind, "unknown");
  }
  assert.equal(identify({ ...base, instructionData: new Uint8Array(1_048_577) } as Transaction).kind, "unknown");
});

test("bounded nested multicalls classify real targets and refuse unbounded recursion", () => {
  const base = makeWalletBirthTransaction(walletBAddress);
  const makeBatch = (instructionData: Uint8Array) => buildMulticallInstruction([{ programIdx: 4, instructionData }]);
  // Account index 4 references Cambrian; authorization calls still carry their original account indices.
  const data = new Uint8Array(11); data[0] = 1;
  const batch = { ...base, program: Pubkey.from(MULTICALL_PROGRAM_ADDRESS), instructionData: makeBatch(data) } as Transaction;
  assert.equal(identify(batch).kind, "pulse");
  const self = { ...batch, readOnlyAccounts: [Pubkey.from(MULTICALL_PROGRAM_ADDRESS)] } as Transaction;
  let nested = data;
  for (let depth = 0; depth < 8; depth++) nested = makeBatch(nested);
  assert.equal(identify({ ...self, instructionData: nested } as Transaction).category, "unknown");
});

test("multiple Cambrian calls in one batch retain one wallet receipt and their individual action count", () => {
  const base = makeWalletBirthTransaction(walletBAddress);
  const pulse = new Uint8Array(11); pulse[0] = 1;
  const batch = { ...base, program: Pubkey.from(MULTICALL_PROGRAM_ADDRESS), instructionData: buildMulticallInstruction([
    { programIdx: 4, instructionData: pulse }, { programIdx: 4, instructionData: pulse },
  ]) } as Transaction;
  assert.equal(identify(batch).kind, "batch");
  assert.deepEqual(summarizeAccountActivity([summary(batch)]), { walletTransactions: 1, confirmedCambrianActions: 2, incompleteConfirmedDetails: false });
});

test("FULL activity reads hydrate metadata-only receipts once, without signing or submitting", async () => {
  const full = makeWalletSetupTransaction();
  const calls: string[] = [];
  const client = { transactions: {
    listForAccount: async (address: string, args: { transactionOptions: { view: TransactionView } }) => {
      assert.equal(address, walletBAddress); assert.equal(args.transactionOptions.view, TransactionView.FULL);
      return { transactions: [{ ...full, instructionData: undefined }], page: { nextPageToken: "next" } };
    },
    get: async (signature: string) => { calls.push(signature); return full; },
    sendAndTrack: () => { throw new Error("History reads must not submit"); },
  } } as unknown as Thru;
  const result = await listAccountTransactions(client, walletBAddress, { cambrianProgramId: config.programId });
  assert.equal(result.transactions[0].activity.label, "Wallet created");
  assert.equal(result.nextPageToken, "next");
  assert.deepEqual(calls, [walletBSetupSignature]);
});

test("unavailable details preserve confirmed history and explicitly mark counts incomplete", async () => {
  const full = makeWalletSetupTransaction();
  const client = { transactions: {
    listForAccount: async () => ({ transactions: [{ ...full, instructionData: undefined }], page: {} }),
    get: async () => { throw new Error("Temporary read failure"); },
  } } as unknown as Thru;
  const result = await listAccountTransactions(client, walletBAddress);
  assert.equal(result.transactions[0].signature, walletBSetupSignature);
  assert.equal(result.transactions[0].status, "confirmed");
  assert.equal(result.transactions[0].activity.category, "unknown");
  assert.equal(summarizeAccountActivity(result.transactions).incompleteConfirmedDetails, true);
});

test("a hydration result for another signature is ignored", async () => {
  const full = makeWalletSetupTransaction();
  const client = { transactions: {
    listForAccount: async () => ({ transactions: [{ ...full, instructionData: undefined }] }),
    get: async () => makeWalletBirthTransaction(),
  } } as unknown as Thru;
  const result = await listAccountTransactions(client, walletBAddress);
  assert.equal(result.transactions[0].signature, walletBSetupSignature);
  assert.equal(result.transactions[0].activity.category, "unknown");
});

test("a cancelled wallet read cannot fetch or publish history for the previous account", async () => {
  const controller = new AbortController(); controller.abort();
  const client = { transactions: { listForAccount: () => { throw new Error("Must not fetch after wallet switch"); } } } as unknown as Thru;
  await assert.rejects(() => listAccountTransactions(client, walletBAddress, { signal: controller.signal }), { name: "AbortError" });
});
