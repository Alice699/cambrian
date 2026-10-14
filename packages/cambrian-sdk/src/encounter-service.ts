import { Pubkey, Transaction, TransactionView, type Thru, type TransactionExecutionResultData } from "@thru/sdk";
import { buildWalletAccountContext, PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import { PasskeyInstruction } from "@thru/sdk/programs/passkey-manager/abi/thru/program/passkey_manager/types";
import type { ThruTransactionIntent } from "@thru/wallet";
import type { CambrianConfig } from "@cambrian/config";
import { base64ToBytes, bytesToBase64, bytesToHex, decodeEncounterEvent, encodeEncounterInstruction, type CambrianEncounterEvent } from "./abi.js";
import { CAMBRIAN_INSTRUCTION_ABI_NAME } from "./constants.js";
import { assertBirthDeployment } from "./deployment.js";
import { encounterEligibility, encounterStateFingerprint, ENCOUNTER_MAX_ENERGY, type EncounterPreview } from "./encounter-model.js";
import { isOrganismControlledBy, readOrganism, type CambrianOrganismRecord } from "./read-service.js";
import type { BirthTransactionStage, CambrianTransactionSigner } from "./transaction-service.js";

export interface EncounterOptions {
  walletAddress: string;
  actorAddress: string;
  donorAddress: string;
  catalyst: bigint;
  signal?: AbortSignal;
}
export interface PreparedEncounterIntent {
  intent: ThruTransactionIntent;
  actor: CambrianOrganismRecord;
  donor: CambrianOrganismRecord;
  actorFingerprint: string;
  donorFingerprint: string;
  catalyst: bigint;
  preview: EncounterPreview;
}
export interface EncounterMetrics {
  fee: bigint;
  feePayer: string;
  slot?: bigint;
  computeUnits?: number;
  memoryUnits?: number;
  stateUnits?: number;
}
export interface EncounterTransactionReceipt {
  stage: "submitted" | "confirmed";
  signature: string;
  walletAddress: string;
  programId: string;
  actorAddress: string;
  donorAddress: string;
  catalyst: bigint;
  baselineEncounterCount: bigint;
  reviewedGenome: string;
  organism?: CambrianOrganismRecord;
  event?: CambrianEncounterEvent;
  metrics?: EncounterMetrics;
}
export interface EncounterTransactionUpdate {
  stage: BirthTransactionStage;
  prepared?: PreparedEncounterIntent;
  receipt?: EncounterTransactionReceipt;
  signature?: string;
  organism?: CambrianOrganismRecord;
  error?: Error;
}
export interface EncounterConfirmationOptions {
  signal?: AbortSignal;
  confirmationTimeoutMs?: number;
  organismTimeoutMs?: number;
  pollIntervalMs?: number;
  onUpdate?: (update: EncounterTransactionUpdate) => void;
}
export class EncounterExecutionError extends Error {
  readonly signature: string;
  readonly vmError: number;
  readonly userErrorCode: bigint;
  constructor(signature: string, vmError: number, userErrorCode: bigint) {
    super(`Encounter execution failed (VM error ${vmError}, program error ${userErrorCode}). No automatic retry is sent.`);
    this.name = "EncounterExecutionError";
    this.signature = signature;
    this.vmError = vmError;
    this.userErrorCode = userErrorCode;
  }
}

export async function prepareEncounterIntent(client: Thru, config: CambrianConfig, options: EncounterOptions): Promise<PreparedEncounterIntent> {
  assertBirthDeployment(config);
  encodeEncounterInstruction(2, 3, options.catalyst);
  const actorAddress = Pubkey.from(options.actorAddress).toThruFmt();
  const donorAddress = Pubkey.from(options.donorAddress).toThruFmt();
  if (actorAddress === donorAddress) throw new Error("Choose two different organisms. Nothing was submitted.");
  options.signal?.throwIfAborted();
  const [actor, donor, node] = await Promise.all([
    readOrganism(client, actorAddress), readOrganism(client, donorAddress), client.node.getStatus(),
  ]);
  options.signal?.throwIfAborted();
  if (actor.address !== actorAddress || donor.address !== donorAddress) throw new Error("The pair read returned an unrelated account. Nothing was submitted.");
  if (!node.ready) throw new Error("Network eligibility is unavailable. No transaction was sent.");
  const eligibility = encounterEligibility(actor, donor, config, options.walletAddress);
  if (!eligibility.allowed || !eligibility.preview) throw new Error(`${eligibility.reason} Nothing was submitted.`);
  const actorBytes = Pubkey.from(actorAddress).toBytes();
  const donorBytes = Pubkey.from(donorAddress).toBytes();
  const context = buildWalletAccountContext({ walletAddress: options.walletAddress,
    readWriteAccounts: [actorBytes], readOnlyAccounts: [Pubkey.from(config.programId).toBytes(), donorBytes] });
  return {
    actor, donor, catalyst: options.catalyst, preview: eligibility.preview,
    actorFingerprint: encounterStateFingerprint(actor), donorFingerprint: encounterStateFingerprint(donor),
    intent: {
      walletAddress: options.walletAddress, programAddress: config.programId,
      instructionData: bytesToBase64(encodeEncounterInstruction(context.getAccountIndex(actorBytes), context.getAccountIndex(donorBytes), options.catalyst)),
      readWriteAddresses: context.readWriteAddresses, readOnlyAddresses: context.readOnlyAddresses,
      stateUnits: 0,
      review: { appName: "Cambrian", programAddress: config.programId, abiName: CAMBRIAN_INSTRUCTION_ABI_NAME, instruction: "encounter" },
    },
  };
}

/** Decode only one managed-wallet Encounter, never an unrelated or extra batch call. */
export function matchesEncounterTransaction(transaction: Transaction, receipt: Pick<EncounterTransactionReceipt,
  "signature" | "walletAddress" | "programId" | "actorAddress" | "donorAddress" | "catalyst">): boolean {
  try {
    if (transaction.getSignature()?.toThruFmt() !== receipt.signature
      || transaction.program.toThruFmt() !== PASSKEY_MANAGER_PROGRAM_ADDRESS || !transaction.instructionData) return false;
    const bytes = transaction.instructionData;
    const validation = PasskeyInstruction.validate(bytes);
    if (!validation.ok || validation.consumed !== bytes.length || bytes[0] !== 1) return false;
    const args = PasskeyInstruction.from_array(bytes)?.payload().asValidate();
    if (!args) return false;
    const accounts = [transaction.feePayer, transaction.program, ...transaction.readWriteAccounts, ...transaction.readOnlyAccounts].map(key => key.toThruFmt());
    const writable = new Set(transaction.readWriteAccounts.map(key => key.toThruFmt()));
    const walletIndex = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, true);
    const target = args.target_instruction;
    const instruction = Uint8Array.from(target.data);
    if (accounts[walletIndex] !== receipt.walletAddress || accounts[target.program_idx] !== receipt.programId
      || instruction.length !== 13 || instruction[0] !== 2) return false;
    const view = new DataView(instruction.buffer, instruction.byteOffset, instruction.byteLength);
    return accounts[view.getUint16(1, true)] === receipt.actorAddress
      && accounts[view.getUint16(3, true)] === receipt.donorAddress
      && view.getBigUint64(5, true) === receipt.catalyst
      && writable.has(receipt.actorAddress) && !writable.has(receipt.donorAddress);
  } catch { return false; }
}

function validEvent(event: CambrianEncounterEvent, receipt: EncounterTransactionReceipt): boolean {
  const outcome = event.compatibility >= 192 ? 1 : event.compatibility >= 96 ? 2 : 3;
  const delta = outcome === 1 ? 128n : outcome === 2 ? 32n : -96n;
  const next = event.energyBefore + delta;
  const after = next < 0n ? 0n : next > ENCOUNTER_MAX_ENERGY ? ENCOUNTER_MAX_ENERGY : next;
  return Pubkey.from(event.actor).toThruFmt() === receipt.actorAddress
    && Pubkey.from(event.donor).toThruFmt() === receipt.donorAddress
    && event.encounterCount > receipt.baselineEncounterCount
    && event.energyBefore <= ENCOUNTER_MAX_ENERGY && event.energyAfter === after
    && event.outcome === outcome && event.geneTransferred === (outcome !== 3);
}

function findEncounterEvent(transaction: Transaction, execution: TransactionExecutionResultData | undefined,
  receipt: EncounterTransactionReceipt): CambrianEncounterEvent | undefined {
  const accounts = [transaction.feePayer, transaction.program, ...transaction.readWriteAccounts, ...transaction.readOnlyAccounts];
  for (const item of execution?.events ?? []) {
    if ((item.program?.toThruFmt() ?? accounts[item.programIdx]?.toThruFmt()) !== receipt.programId) continue;
    try {
      const event = decodeEncounterEvent(item.payload);
      if (validEvent(event, receipt)) return event;
    } catch { /* An unrelated/malformed event cannot verify this action. */ }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** A pending/reloaded receipt only performs RPC reads, never a new approval or send. */
export async function confirmEncounterTransaction(client: Thru, config: CambrianConfig, receipt: EncounterTransactionReceipt,
  options: EncounterConfirmationOptions = {}): Promise<EncounterTransactionReceipt> {
  if (!receipt.signature || receipt.programId !== config.programId || receipt.actorAddress === receipt.donorAddress) {
    throw new Error("Encounter receipt does not match this deployment.");
  }
  const result: EncounterTransactionReceipt = { ...receipt, organism: undefined, event: undefined, metrics: undefined };
  const interval = options.pollIntervalMs ?? 1_500;
  const confirmationDeadline = Date.now() + (options.confirmationTimeoutMs ?? 30_000);
  let execution: TransactionExecutionResultData | undefined;
  while (!options.signal?.aborted) {
    try { execution = (await client.transactions.getStatus(receipt.signature)).executionResult; } catch { /* Missing status is not failure. */ }
    if (execution) {
      if (execution.vmError !== 0) throw new EncounterExecutionError(receipt.signature, execution.vmError, execution.userErrorCode);
      result.stage = "confirmed";
      break;
    }
    if (Date.now() >= confirmationDeadline) break;
    await delay(interval, options.signal);
  }
  options.onUpdate?.({ stage: execution ? "syncing" : "submitted", receipt: result, signature: result.signature });
  if (!execution || options.signal?.aborted) return result;
  const stateDeadline = Date.now() + (options.organismTimeoutMs ?? 15_000);
  while (!options.signal?.aborted) {
    try {
      const full = await client.transactions.get(receipt.signature, { view: TransactionView.FULL });
      options.signal?.throwIfAborted();
      if (full.executionResult && full.executionResult.vmError !== 0) {
        throw new EncounterExecutionError(receipt.signature, full.executionResult.vmError, full.executionResult.userErrorCode);
      }
      let transaction = full;
      if (!full.instructionData?.length) {
        transaction = Transaction.fromWire((await client.transactions.getRaw(receipt.signature)).rawTransaction);
        transaction.slot = full.slot;
      }
      if (matchesEncounterTransaction(transaction, receipt)) {
        const event = findEncounterEvent(transaction, full.executionResult ?? execution, receipt);
        if (event) {
          const organism = await readOrganism(client, receipt.actorAddress);
          options.signal?.throwIfAborted();
          // The event is the transaction's result. A later action may already have
          // changed current Energy/genome; do not attribute that action to Encounter.
          if (organism.address === receipt.actorAddress && organism.owner === config.programId && isOrganismControlledBy(organism, receipt.walletAddress)
            && organism.state.encounterCount >= event.encounterCount) {
            const actual = full.executionResult ?? execution;
            result.organism = organism;
            result.event = event;
            result.metrics = { fee: transaction.fee, feePayer: transaction.feePayer.toThruFmt(), slot: full.slot,
              computeUnits: actual?.consumedComputeUnits, memoryUnits: actual?.consumedMemoryUnits, stateUnits: actual?.consumedStateUnits };
            options.onUpdate?.({ stage: "confirmed", receipt: result, signature: result.signature, organism });
            return result;
          }
        }
      }
    } catch (error) {
      if (error instanceof EncounterExecutionError) throw error;
      // Preserve a yellow receipt through event/state indexing delays.
    }
    if (Date.now() >= stateDeadline) break;
    await delay(interval, options.signal);
  }
  return result;
}

export async function executeEncounterTransaction(client: Thru, config: CambrianConfig, wallet: CambrianTransactionSigner,
  options: EncounterOptions & EncounterConfirmationOptions & { reviewed?: PreparedEncounterIntent; timeoutMs?: number }): Promise<EncounterTransactionReceipt> {
  let prepared: PreparedEncounterIntent | undefined;
  let receipt: EncounterTransactionReceipt | undefined;
  try {
    if (!wallet.connected) throw new Error("Connect Thru Wallet before approving Encounter.");
    options.signal?.throwIfAborted();
    options.onUpdate?.({ stage: "preparing" });
    prepared = await prepareEncounterIntent(client, config, options);
    if (options.reviewed && (prepared.actorFingerprint !== options.reviewed.actorFingerprint
      || prepared.donorFingerprint !== options.reviewed.donorFingerprint || prepared.catalyst !== options.reviewed.catalyst)) {
      throw new Error("The pair changed since review. Review it again; nothing was submitted.");
    }
    options.signal?.throwIfAborted();
    options.onUpdate?.({ stage: "awaiting-approval", prepared });
    options.signal?.throwIfAborted();
    const signed = await wallet.signTransaction(prepared.intent);
    options.signal?.throwIfAborted();
    if (!wallet.connected) throw new Error("Thru Wallet disconnected during approval. Nothing was submitted.");
    options.onUpdate?.({ stage: "signed", prepared });
    const fresh = await prepareEncounterIntent(client, config, options);
    if (fresh.actorFingerprint !== prepared.actorFingerprint || fresh.donorFingerprint !== prepared.donorFingerprint) {
      throw new Error("An organism changed during approval. Review the pair again; nothing was submitted.");
    }
    const raw = base64ToBytes(signed);
    const transaction = Transaction.fromWire(raw);
    const signature = transaction.getSignature()?.toThruFmt();
    if (!signature) throw new Error("Thru Wallet returned an unsigned transaction.");
    const candidate: EncounterTransactionReceipt = { stage: "submitted", signature, walletAddress: options.walletAddress,
      programId: config.programId, actorAddress: prepared.actor.address, donorAddress: prepared.donor.address,
      catalyst: options.catalyst, baselineEncounterCount: prepared.actor.state.encounterCount,
      reviewedGenome: bytesToHex(prepared.actor.state.genome) };
    if (!matchesEncounterTransaction(transaction, candidate)) throw new Error("The signed transaction does not match the reviewed Encounter. Nothing was submitted.");
    options.signal?.throwIfAborted();
    receipt = candidate;
    options.onUpdate?.({ stage: "submitting", prepared, receipt, signature });
    try {
      options.signal?.throwIfAborted();
      for await (const update of client.transactions.sendAndTrack(raw, { timeoutMs: options.timeoutMs ?? 30_000, signal: options.signal })) {
        if (update.signature && client.helpers.createSignature(update.signature.value).toThruFmt() !== signature) continue;
        if (update.executionResult) {
          if (update.executionResult.vmError !== 0) throw new EncounterExecutionError(signature, update.executionResult.vmError, update.executionResult.userErrorCode);
          receipt.stage = "confirmed";
          break;
        }
        options.onUpdate?.({ stage: "submitted", prepared, receipt, signature });
      }
    } catch (error) {
      if (error instanceof EncounterExecutionError) throw error;
      // Submission response uncertainty never authorizes a second send.
    }
    return await confirmEncounterTransaction(client, config, receipt, options);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("Encounter could not be completed.");
    options.onUpdate?.({ stage: "failed", prepared, receipt, signature: receipt?.signature, error });
    throw error;
  }
}
