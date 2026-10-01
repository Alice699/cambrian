import type { Thru } from "@thru/sdk/client";
import type { IThruChain, ThruTransactionIntent } from "@thru/wallet";
import type { CambrianConfig } from "@cambrian/config";
import { base64ToBytes } from "./abi.js";
import { prepareBirthIntent, type BirthIntentOptions, type PreparedBirthIntent } from "./client.js";
import { assertBirthDeployment } from "./deployment.js";

export type BirthTransactionStage =
  | "preparing"
  | "awaiting-approval"
  | "signed"
  | "submitting"
  | "submitted"
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
  error?: Error;
}

export interface ExecuteBirthTransactionOptions extends BirthIntentOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (update: BirthTransactionUpdate) => void;
}

export interface BirthTransactionResult {
  stage: "submitted" | "confirmed";
  prepared: PreparedBirthIntent;
  signature?: string;
  slot?: bigint;
  vmError?: number;
}

export async function executeBirthTransaction(
  client: Thru,
  config: CambrianConfig,
  wallet: IThruChain,
  options: ExecuteBirthTransactionOptions,
): Promise<BirthTransactionResult> {
  assertBirthDeployment(config);
  if (!wallet.connected) throw new Error("Wallet must be connected before signing birth");

  const notify = (update: BirthTransactionUpdate) => options.onUpdate?.(update);
  notify({ stage: "preparing" });

  let prepared: PreparedBirthIntent | undefined;
  try {
    prepared = await prepareBirthIntent(client, config, options);
    notify({ stage: "awaiting-approval", prepared, intent: prepared.intent });

    const signedTransaction = await wallet.signTransaction(prepared.intent);
    notify({ stage: "signed", prepared, intent: prepared.intent });

    const rawTransaction = base64ToBytes(signedTransaction);
    notify({ stage: "submitting", prepared, intent: prepared.intent });

    let signature: string | undefined;
    let slot: bigint | undefined;
    let vmError: number | undefined;
    let reachedExecution = false;

    for await (const update of client.transactions.sendAndTrack(rawTransaction, {
      timeoutMs: options.timeoutMs ?? 60_000,
      signal: options.signal,
    })) {
      if (update.signature) {
        signature = client.helpers.createSignature(update.signature.value).toThruFmt();
      }
      vmError = update.executionResult?.vmError ?? vmError;

      if (update.executionResult) {
        reachedExecution = true;
        if (update.executionResult.vmError !== 0) {
          const error = new Error("Birth transaction execution failed with VM error " + update.executionResult.vmError);
          notify({
            stage: "failed",
            prepared,
            signature,
            slot,
            vmError: update.executionResult.vmError,
            error,
          });
          throw error;
        }

        notify({ stage: "confirmed", prepared, signature, slot, vmError: 0 });
      } else {
        notify({
          stage: "submitting",
          prepared,
          signature,
          slot,
          submissionStatus: String(update.status),
        });
      }
    }

    if (!reachedExecution) {
      notify({ stage: "submitted", prepared, signature, slot, vmError });
      return { stage: "submitted", prepared, signature, slot, vmError };
    }

    return { stage: "confirmed", prepared, signature, slot, vmError: 0 };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("Birth transaction failed");
    if (prepared) notify({ stage: "failed", prepared, error: normalized });
    throw normalized;
  }
}
