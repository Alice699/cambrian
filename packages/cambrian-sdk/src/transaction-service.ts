import type { Thru } from "@thru/sdk/client";
import { Transaction, TransactionVmError } from "@thru/sdk";
import type { ThruTransactionIntent } from "@thru/wallet";
import type { CambrianConfig } from "@cambrian/config";
import { base64ToBytes } from "./abi.js";
import { prepareBirthIntent, type BirthIntentOptions, type PreparedBirthIntent } from "./client.js";
import { assertBirthDeployment } from "./deployment.js";
import { readOrganism, isOrganismControlledBy, type CambrianOrganismRecord } from "./read-service.js";
import { CAMBRIAN_BIRTH_STATE_UNITS, CAMBRIAN_ORGANISM_MAGIC, CAMBRIAN_ORGANISM_VERSION } from "./constants.js";

export type BirthTransactionStage =
  | "connecting"
  | "preparing"
  | "awaiting-approval"
  | "signed"
  | "submitting"
  | "submitted"
  | "syncing"
  | "confirmed"
  | "failed";

export interface BirthTransactionUpdate {
  stage: BirthTransactionStage;
  prepared?: PreparedBirthIntent;
  intent?: ThruTransactionIntent;
  signature?: string;
  submissionStatus?: string;
  slot?: bigint;
  vmError?: number;
  organism?: CambrianOrganismRecord;
  error?: Error;
}

export interface ExecuteBirthTransactionOptions extends BirthIntentOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  confirmationTimeoutMs?: number;
  organismTimeoutMs?: number;
  pollIntervalMs?: number;
  onUpdate?: (update: BirthTransactionUpdate) => void;
}

export interface BirthTransactionResult {
  stage: "submitted" | "confirmed";
  prepared: PreparedBirthIntent;
  signature?: string;
  slot?: bigint;
  vmError?: number;
  organism?: CambrianOrganismRecord;
}

export class BirthExecutionError extends Error {
  readonly signature: string;
  readonly vmError: number;
  readonly userErrorCode: bigint;

  constructor(signature: string, vmError: number, userErrorCode: bigint) {
    super(vmError === TransactionVmError.TRANSACTION_VM_ERROR_SU_EXHAUSTED
      ? "Birth ran out of state units while creating the organism (VM error -763). The transaction failed. Refresh the app and wallet before approving a new Birth."
      : `Birth execution failed (VM error ${vmError}, program error ${userErrorCode.toString()}).`);
    this.name = "BirthExecutionError";
    this.signature = signature;
    this.vmError = vmError;
    this.userErrorCode = userErrorCode;
  }
}

export class BirthResourceBudgetError extends Error {
  readonly requestedStateUnits: number;
  readonly requiredStateUnits = CAMBRIAN_BIRTH_STATE_UNITS;

  constructor(requestedStateUnits: number) {
    super(`Your wallet signed Birth with ${requestedStateUnits} state units; at least ${CAMBRIAN_BIRTH_STATE_UNITS} is required. Nothing was submitted. Refresh the app and wallet, then approve Birth again.`);
    this.name = "BirthResourceBudgetError";
    this.requestedStateUnits = requestedStateUnits;
  }
}

type BirthConfirmationOptions = Pick<ExecuteBirthTransactionOptions,
  "signal" | "onUpdate" | "confirmationTimeoutMs" | "organismTimeoutMs" | "pollIntervalMs"
>;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** Check the existing transaction and organism without signing or sending again. */
export async function confirmBirthTransaction(
  client: Thru,
  config: CambrianConfig,
  receipt: BirthTransactionResult,
  options: BirthConfirmationOptions = {},
): Promise<BirthTransactionResult> {
  const notify = (update: BirthTransactionUpdate) => options.onUpdate?.(update);
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  let confirmed = receipt.stage === "confirmed";

  if (!confirmed && receipt.signature) {
    const deadline = Date.now() + (options.confirmationTimeoutMs ?? 30_000);
    while (!options.signal?.aborted) {
      let execution;
      try {
        execution = (await client.transactions.getStatus(receipt.signature)).executionResult;
      } catch {
        // An unavailable status or a missing index entry is not an execution failure.
      }
      if (execution) {
        if (execution.vmError !== 0) {
          const error = new BirthExecutionError(receipt.signature, execution.vmError, execution.userErrorCode);
          throw error;
        }
        confirmed = true;
        break;
      }
      if (Date.now() >= deadline) break;
      await delay(pollIntervalMs, options.signal);
    }
  }

  if (!confirmed) {
    notify({ stage: "submitted", prepared: receipt.prepared, signature: receipt.signature });
    return { ...receipt, stage: "submitted" };
  }

  notify({ stage: "syncing", prepared: receipt.prepared, signature: receipt.signature, vmError: 0 });
  const deadline = Date.now() + (options.organismTimeoutMs ?? 15_000);
  while (!options.signal?.aborted) {
    let organism: CambrianOrganismRecord | undefined;
    try {
      const account = await readOrganism(client, receipt.prepared.organismAddress);
      if (account.owner === config.programId && account.state.magic === CAMBRIAN_ORGANISM_MAGIC && account.state.version === CAMBRIAN_ORGANISM_VERSION) {
        // A confirmed transaction is not a completed wallet Birth until ownership matches.
        if (receipt.prepared.intent.review?.instruction !== "wallet_birth"
          || (receipt.prepared.intent.walletAddress && isOrganismControlledBy(account, receipt.prepared.intent.walletAddress))) {
          organism = account;
        }
      }
    } catch {
      // Execution can finish before the account read endpoint exposes its data.
    }
    if (organism) {
      const result: BirthTransactionResult = {
        ...receipt, stage: "confirmed", vmError: 0, slot: organism.state.bornSlot, organism,
      };
      notify({ stage: "confirmed", prepared: result.prepared, signature: result.signature, slot: result.slot, vmError: 0, organism });
      return result;
    }
    if (Date.now() >= deadline) break;
    await delay(pollIntervalMs, options.signal);
  }

  return { ...receipt, stage: "confirmed", vmError: 0 };
}

export type CambrianTransactionSigner = {
  readonly connected: boolean;
  signTransaction(transaction: ThruTransactionIntent): Promise<string>;
};

export async function executeBirthTransaction(
  client: Thru,
  config: CambrianConfig,
  wallet: CambrianTransactionSigner,
  options: ExecuteBirthTransactionOptions,
): Promise<BirthTransactionResult> {
  assertBirthDeployment(config);
  if (!wallet.connected) throw new Error("Wallet must be connected before signing birth");

  const notify = (update: BirthTransactionUpdate) => options.onUpdate?.(update);
  notify({ stage: "preparing" });

  let prepared: PreparedBirthIntent | undefined;
  let signature: string | undefined;
  try {
    prepared = await prepareBirthIntent(client, config, options);
    options.signal?.throwIfAborted();
    notify({ stage: "awaiting-approval", prepared, intent: prepared.intent });

    const signedTransaction = await wallet.signTransaction(prepared.intent);
    options.signal?.throwIfAborted();
    notify({ stage: "signed", prepared, intent: prepared.intent });

    const rawTransaction = base64ToBytes(signedTransaction);
    if (rawTransaction.length < 64) throw new Error("Thru Wallet returned an incomplete signed transaction.");
    // Check the wallet's actual signed header, not just our requested intent.
    // Never repair/re-sign the returned wire bytes or broadcast a known-bad budget.
    const transaction = Transaction.fromWire(rawTransaction);
    if (transaction.requestedStateUnits < CAMBRIAN_BIRTH_STATE_UNITS) {
      throw new BirthResourceBudgetError(transaction.requestedStateUnits);
    }
    signature = client.helpers.createSignature(rawTransaction.slice(-64)).toThruFmt();
    options.signal?.throwIfAborted();
    // Publish the public receipt before opening the response stream. A wallet
    // switch or dropped stream must not lose the only safe way to reconcile it.
    notify({ stage: "submitting", prepared, intent: prepared.intent, signature });

    let reachedExecution = false;

    try {
      for await (const update of client.transactions.sendAndTrack(rawTransaction, {
        timeoutMs: options.timeoutMs ?? 30_000,
        signal: options.signal,
      })) {
        if (update.signature) signature = client.helpers.createSignature(update.signature.value).toThruFmt();
        if (update.executionResult) {
          if (update.executionResult.vmError !== 0) {
            throw new BirthExecutionError(signature, update.executionResult.vmError, update.executionResult.userErrorCode);
          }
          reachedExecution = true;
          break;
        }
        notify({ stage: "submitted", prepared, signature, submissionStatus: String(update.status) });
      }
    } catch (error) {
      if (error instanceof BirthExecutionError) throw error;
      // A disconnected response stream does not prove the submitted transaction failed.
      // Reconcile its signature through read-only status calls; never resubmit here.
    }

    return await confirmBirthTransaction(client, config, {
      stage: reachedExecution ? "confirmed" : "submitted",
      prepared,
      signature,
    }, options);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("Birth transaction failed");
    if (prepared) notify({ stage: "failed", prepared, signature, error: normalized });
    throw normalized;
  }
}
