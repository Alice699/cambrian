import { Pubkey, Transaction, type Thru } from "@thru/sdk";
import { buildWalletAccountContext } from "@thru/programs/passkey-manager";
import type { ThruTransactionIntent } from "@thru/wallet";
import type { CambrianConfig } from "@cambrian/config";
import { base64ToBytes, bytesToBase64, encodePulseInstruction } from "./abi.js";
import { CAMBRIAN_INSTRUCTION_ABI_NAME, CAMBRIAN_MAX_PULSE_ELAPSED, CAMBRIAN_ORGANISM_MAGIC, CAMBRIAN_ORGANISM_VERSION } from "./constants.js";
import { assertBirthDeployment } from "./deployment.js";
import { isOrganismControlledBy, readOrganism, type CambrianOrganismRecord } from "./read-service.js";
import type { BirthTransactionStage, CambrianTransactionSigner } from "./transaction-service.js";

export type PulseTransactionStage = BirthTransactionStage;
export type PulseEligibility = { allowed: boolean; reason: string; elapsed: bigint | null };

/** Mirrors the existing C checks. Never uses wall-clock time or changes the program. */
export function pulseEligibility(organism: CambrianOrganismRecord, config: CambrianConfig, walletAddress: string, slot: bigint): PulseEligibility {
  const deny = (reason: string, elapsed: bigint | null = null): PulseEligibility => ({ allowed: false, reason, elapsed });
  if (organism.owner !== config.programId) return deny("This account is not owned by the Cambrian program.");
  if (organism.state.magic !== CAMBRIAN_ORGANISM_MAGIC || organism.state.version !== CAMBRIAN_ORGANISM_VERSION) return deny("This account has an unsupported Cambrian layout.");
  try {
    if (!isOrganismControlledBy(organism, walletAddress)) return deny("Only this organism's controller can approve Pulse. Switch to its wallet.");
  } catch { return deny("The wallet or organism address is invalid."); }
  if (organism.state.status === 3) return deny("This organism is dead and cannot Pulse. Its on-chain record is unchanged.");
  if (![1, 2].includes(organism.state.status)) return deny("This organism has an unsupported status.");
  if (organism.state.pulseCount === 0xffff_ffff_ffff_ffffn) return deny("The organism's Pulse counter has reached its limit.");
  if (typeof slot !== "bigint" || slot <= organism.state.lastPulseSlot) return deny("Waiting for a newer network slot. Refresh eligibility before approving Pulse.");
  const elapsed = slot - organism.state.lastPulseSlot;
  if (elapsed > CAMBRIAN_MAX_PULSE_ELAPSED) return deny("Pulse window expired: the program allows at most 4,096 slots since Birth or the last Pulse. Create a new organism in Overview to test Pulse; this record is preserved.", elapsed);
  return { allowed: true, reason: "Pulse changes energy and vitality and may mutate the organism. Review the request in Thru Wallet.", elapsed };
}

export async function readPulseEligibility(client: Thru, config: CambrianConfig, walletAddress: string, organismAddress: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const organism = await readOrganism(client, organismAddress);
  signal?.throwIfAborted();
  const node = await client.node.getStatus();
  signal?.throwIfAborted();
  if (!node.ready || typeof node.locallyExecutedSlot !== "bigint" || node.locallyExecutedSlot <= 0n) {
    throw new Error("Network eligibility is unavailable. Refresh the read; no transaction was sent.");
  }
  return { organism, slot: node.locallyExecutedSlot, ...pulseEligibility(organism, config, walletAddress, node.locallyExecutedSlot) };
}

export interface PreparedPulseIntent {
  intent: ThruTransactionIntent;
  organismAddress: string;
  baselinePulseCount: bigint;
  lastPulseSlot: bigint;
}

/** Only public reconciliation data. Does not contain an intent or signed/auth bytes. */
export interface PulseTransactionReceipt {
  stage: "submitted" | "confirmed";
  signature: string;
  walletAddress: string;
  programId: string;
  organismAddress: string;
  baselinePulseCount: bigint;
  lastPulseSlot: bigint;
  organism?: CambrianOrganismRecord;
}

export interface PulseTransactionUpdate {
  stage: PulseTransactionStage;
  prepared?: PreparedPulseIntent;
  receipt?: PulseTransactionReceipt;
  signature?: string;
  organism?: CambrianOrganismRecord;
  error?: Error;
}

export interface PulseConfirmationOptions {
  signal?: AbortSignal;
  confirmationTimeoutMs?: number;
  organismTimeoutMs?: number;
  pollIntervalMs?: number;
  onUpdate?: (update: PulseTransactionUpdate) => void;
}

export class PulseExecutionError extends Error {
  readonly signature: string;
  readonly vmError: number;
  readonly userErrorCode: bigint;
  constructor(signature: string, vmError: number, userErrorCode: bigint) {
    const explanation = userErrorCode === 0xca010010n ? " The Pulse slot window changed or expired; refresh eligibility before a new approval."
      : userErrorCode === 0xca01000cn ? " The selected wallet is not the authorized controller."
      : userErrorCode === 0xca01000dn ? " The organism can no longer Pulse in its current state." : "";
    super(`Pulse execution failed (VM error ${vmError}, program error ${userErrorCode}).${explanation}`);
    this.name = "PulseExecutionError";
    this.signature = signature;
    this.vmError = vmError;
    this.userErrorCode = userErrorCode;
  }
}

export async function preparePulseIntent(client: Thru, config: CambrianConfig, options: { walletAddress: string; organismAddress: string; catalyst: bigint; signal?: AbortSignal }): Promise<PreparedPulseIntent> {
  assertBirthDeployment(config);
  // Validate the fixed-size payload before any RPC or wallet approval.
  encodePulseInstruction(2, options.catalyst);
  const { organism, allowed, reason } = await readPulseEligibility(client, config, options.walletAddress, options.organismAddress, options.signal);
  if (!allowed) throw new Error(`${reason} Nothing was submitted.`);
  const organismBytes = Pubkey.from(options.organismAddress).toBytes();
  const context = buildWalletAccountContext({
    walletAddress: options.walletAddress,
    readWriteAccounts: [organismBytes],
    readOnlyAccounts: [Pubkey.from(config.programId).toBytes()],
  });
  return {
    organismAddress: organism.address,
    baselinePulseCount: organism.state.pulseCount,
    lastPulseSlot: organism.state.lastPulseSlot,
    intent: {
      walletAddress: options.walletAddress, programAddress: config.programId,
      instructionData: bytesToBase64(encodePulseInstruction(context.getAccountIndex(organismBytes), options.catalyst)),
      readWriteAddresses: context.readWriteAddresses, readOnlyAddresses: context.readOnlyAddresses,
      // Pulse changes existing state only; it does not create or resize an account.
      stateUnits: 0,
      review: { appName: "Cambrian", programAddress: config.programId, abiName: CAMBRIAN_INSTRUCTION_ABI_NAME, instruction: "pulse" },
    },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** Reconcile an existing receipt using reads only. Never reapprove or resend. */
export async function confirmPulseTransaction(client: Thru, config: CambrianConfig, receipt: PulseTransactionReceipt, options: PulseConfirmationOptions = {}): Promise<PulseTransactionReceipt> {
  if (!receipt.signature || receipt.programId !== config.programId) throw new Error("Pulse receipt does not match this deployment.");
  let confirmed = receipt.stage === "confirmed";
  const interval = options.pollIntervalMs ?? 1_500;
  if (!confirmed) {
    const deadline = Date.now() + (options.confirmationTimeoutMs ?? 30_000);
    while (!options.signal?.aborted) {
      let execution;
      try { execution = (await client.transactions.getStatus(receipt.signature)).executionResult; } catch { /* Missing index entry is not failure. */ }
      if (options.signal?.aborted) break;
      if (execution) {
        if (execution.vmError !== 0) throw new PulseExecutionError(receipt.signature, execution.vmError, execution.userErrorCode);
        confirmed = true;
        break;
      }
      if (Date.now() >= deadline) break;
      await delay(interval, options.signal);
    }
  }
  const result: PulseTransactionReceipt = { ...receipt, stage: confirmed ? "confirmed" : "submitted", organism: undefined };
  options.onUpdate?.({ stage: confirmed ? "syncing" : "submitted", receipt: result, signature: result.signature });
  if (!confirmed) return result;
  const deadline = Date.now() + (options.organismTimeoutMs ?? 15_000);
  while (!options.signal?.aborted) {
    try {
      const organism = await readOrganism(client, result.organismAddress);
      if (options.signal?.aborted) break;
      // A successful receipt plus stale pre-Pulse data is still syncing, not green.
      if (organism.owner === config.programId && isOrganismControlledBy(organism, result.walletAddress)
        && organism.state.pulseCount > result.baselinePulseCount && organism.state.lastPulseSlot > result.lastPulseSlot) {
        result.organism = organism;
        options.onUpdate?.({ stage: "confirmed", receipt: result, signature: result.signature, organism });
        return result;
      }
    } catch { /* Poll through stale or unavailable account data. */ }
    if (Date.now() >= deadline) break;
    await delay(interval, options.signal);
  }
  return result;
}

export async function executePulseTransaction(client: Thru, config: CambrianConfig, wallet: CambrianTransactionSigner,
  options: PulseConfirmationOptions & { walletAddress: string; organismAddress: string; catalyst: bigint; timeoutMs?: number }): Promise<PulseTransactionReceipt> {
  let prepared: PreparedPulseIntent | undefined;
  let receipt: PulseTransactionReceipt | undefined;
  try {
    if (!wallet.connected) throw new Error("Connect Thru Wallet before approving Pulse.");
    options.signal?.throwIfAborted();
    options.onUpdate?.({ stage: "preparing" });
    prepared = await preparePulseIntent(client, config, options);
    options.signal?.throwIfAborted();
    options.onUpdate?.({ stage: "awaiting-approval", prepared });
    options.signal?.throwIfAborted();
    const signed = await wallet.signTransaction(prepared.intent);
    options.signal?.throwIfAborted();
    if (!wallet.connected) throw new Error("Thru Wallet disconnected during approval. Nothing was submitted.");
    options.onUpdate?.({ stage: "signed", prepared });
    // Approval may take minutes. Revalidate controller, slot window and the baseline
    // without changing the canonical transaction returned by the official wallet.
    const fresh = await readPulseEligibility(client, config, options.walletAddress, prepared.organismAddress, options.signal);
    if (!fresh.allowed) throw new Error(`${fresh.reason} Nothing was submitted.`);
    if (fresh.organism.state.pulseCount !== prepared.baselinePulseCount || fresh.organism.state.lastPulseSlot !== prepared.lastPulseSlot) {
      throw new Error("The organism changed during approval. Refresh its state and review a new Pulse. Nothing was submitted.");
    }
    const raw = base64ToBytes(signed);
    if (raw.length < 64) throw new Error("Thru Wallet returned an incomplete signed transaction.");
    const transaction = Transaction.fromWire(raw);
    const signature = transaction.getSignature()?.toThruFmt();
    if (!signature) throw new Error("Thru Wallet returned an unsigned transaction.");
    options.signal?.throwIfAborted();
    receipt = { stage: "submitted", signature, walletAddress: options.walletAddress, programId: config.programId,
      organismAddress: prepared.organismAddress, baselinePulseCount: prepared.baselinePulseCount, lastPulseSlot: prepared.lastPulseSlot };
    options.onUpdate?.({ stage: "submitting", prepared, receipt, signature });
    try {
      options.signal?.throwIfAborted();
      for await (const update of client.transactions.sendAndTrack(raw, { timeoutMs: options.timeoutMs ?? 30_000, signal: options.signal })) {
        if (update.signature && client.helpers.createSignature(update.signature.value).toThruFmt() !== signature) continue;
        if (update.executionResult) {
          if (update.executionResult.vmError !== 0) throw new PulseExecutionError(signature, update.executionResult.vmError, update.executionResult.userErrorCode);
          receipt.stage = "confirmed";
          break;
        }
        options.onUpdate?.({ stage: "submitted", receipt, signature });
      }
    } catch (cause) {
      if (cause instanceof PulseExecutionError) throw cause;
      // A dropped stream is uncertain, not failed. The same signature is read
      // back below; no retry here may submit a second transaction.
    }
    return await confirmPulseTransaction(client, config, receipt, options);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("Pulse could not be completed.");
    options.onUpdate?.({ stage: "failed", prepared, receipt, signature: receipt?.signature, error });
    throw error;
  }
}
