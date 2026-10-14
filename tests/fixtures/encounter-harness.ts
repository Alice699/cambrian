import { createThruClient, keys, Pubkey, Transaction, type Thru } from "@thru/sdk";
import { buildWalletAccountContext, encodeValidateInstruction, PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import type { ThruTransactionIntent } from "@thru/wallet";
import { defaultCambrianConfig as config } from "../../packages/config/src/index.ts";
import { base64ToBytes, bytesToBase64 } from "../../packages/cambrian-sdk/src/abi.ts";

// Offline synthetic signing key only; never used with the official wallet or RPC.
const testKey = new Uint8Array(32).fill(0x17);
export const encounterFeePayer = Pubkey.from(await keys.fromPrivateKey(testKey)).toThruFmt();
export const encounterWallet = Pubkey.from(new Uint8Array(32).fill(0x44)).toThruFmt();
export const encounterOtherWallet = Pubkey.from(new Uint8Array(32).fill(0x55)).toThruFmt();
export const encounterActor = Pubkey.from(new Uint8Array(32).fill(0x66)).toThruFmt();
export const encounterDonor = Pubkey.from(new Uint8Array(32).fill(0x22)).toThruFmt();
export const encounterOtherOrganism = Pubkey.from(new Uint8Array(32).fill(0x88)).toThruFmt();

export interface EncounterHarnessOptions {
  donorBits?: number;
  energy?: bigint;
  vitality?: bigint;
  deadActor?: boolean;
  deadDonor?: boolean;
  otherController?: "actor" | "donor";
  wrongOwner?: "actor" | "donor";
  wrongMagic?: "actor" | "donor";
  nodeReady?: boolean;
  saturatedCounter?: boolean;
  reject?: boolean;
  changedActor?: boolean;
  changedDonor?: boolean;
  badSigned?: boolean;
  stale?: boolean;
  unreadable?: boolean;
  wrongResultOwner?: boolean;
  wrongResultController?: boolean;
  wrongResultAddress?: boolean;
  fullFailed?: boolean;
  stream?: "accepted" | "disconnect" | "failed";
  status?: "pending" | "unavailable" | "failed";
  missingEvent?: boolean;
  badEvent?: "actor" | "donor" | "program" | "energy" | "count";
  metadataOnly?: boolean;
  laterAction?: boolean;
  approvalGate?: Promise<void>;
  afterApproval?: () => void;
  afterSubmission?: () => void;
}
type State = { controller: string; genome: Uint8Array; energy: bigint; vitality: bigint; count: bigint; status: number; last: bigint; memory: Uint8Array; seq: bigint };

export function createEncounterHarness(options: EncounterHarnessOptions = {}) {
  const sdk = createThruClient({ baseUrl: config.rpcUrl });
  const donorGenome = new Uint8Array(32);
  for (let bit = 0; bit < (options.donorBits ?? 1); bit++) donorGenome[Math.floor(bit / 8)] |= 1 << (bit % 8);
  const states = new Map<string, State>([
    [encounterActor, { controller: options.otherController === "actor" ? encounterOtherWallet : encounterWallet, genome: new Uint8Array(32), energy: options.energy ?? 2048n, vitality: options.vitality ?? 768n, count: options.saturatedCounter ? 0xffff_ffff_ffff_ffffn : 0n, status: options.deadActor ? 3 : 1, last: 123n, memory: new Uint8Array(32), seq: 1n }],
    [encounterDonor, { controller: options.otherController === "donor" ? encounterOtherWallet : encounterWallet, genome: donorGenome, energy: 1800n, vitality: 900n, count: 0n, status: options.deadDonor ? 3 : 1, last: 120n, memory: new Uint8Array(32), seq: 1n }],
    [encounterOtherOrganism, { controller: encounterOtherWallet, genome: new Uint8Array(32).fill(0xaa), energy: 2048n, vitality: 768n, count: 0n, status: 1, last: 122n, memory: new Uint8Array(32), seq: 1n }],
  ]);
  const trace = { approvals: 0, sends: 0, contextReads: 0, accountReads: 0, statusReads: 0, transactionReads: 0,
    intents: [] as ThruTransactionIntent[], signed: undefined as Uint8Array | undefined, submitted: undefined as Uint8Array | undefined,
    transaction: undefined as Transaction | undefined, signature: "", event: undefined as Uint8Array | undefined };

  const record = (address: string) => {
    if (address === encounterWallet || address === encounterOtherWallet) {
      return { address: Pubkey.from(address), meta: { balance: address === encounterWallet ? 300n : 0n, dataSize: 0 } };
    }
    const state = states.get(address);
    if (!state) throw new Error("Unknown offline organism");
    const role = address === encounterActor ? "actor" : "donor";
    const after = trace.sends > 0 && address === encounterActor;
    if (after && options.unreadable) throw new Error("Offline index is delayed");
    const data = new Uint8Array(264), view = new DataView(data.buffer);
    view.setUint32(0, options.wrongMagic === role ? 0 : 0x43414d42, true);
    view.setUint8(4, 1); view.setUint8(5, state.status);
    data.set(Pubkey.from(after && options.wrongResultController ? encounterOtherWallet : state.controller).toBytes(), 8);
    data.set(state.genome, 104); data.set(state.memory, 168);
    view.setBigUint64(200, 100n, true); view.setBigUint64(208, state.last, true);
    view.setBigUint64(224, state.energy, true); view.setBigUint64(232, state.vitality, true); view.setBigUint64(248, state.count, true);
    if (options.changedActor && address === encounterActor) data[167] ^= 1;
    if (options.changedDonor && address === encounterDonor) data[167] ^= 1;
    if (after && options.stale) { view.setBigUint64(248, 0n, true); }
    return { address: Pubkey.from(after && options.wrongResultAddress ? encounterDonor : address), meta: { owner: Pubkey.from(options.wrongOwner === role || (after && options.wrongResultOwner) ? encounterOtherWallet : config.programId), dataSize: 264, balance: 0n, seq: state.seq }, data: { data, compressed: false } };
  };
  const execution = (failed = false) => {
    const programIdx = trace.transaction ? [trace.transaction.feePayer, trace.transaction.program, ...trace.transaction.readWriteAccounts, ...trace.transaction.readOnlyAccounts].findIndex(key => key.toThruFmt() === config.programId) : 0;
    const payload = trace.event?.slice();
    if (payload && options.badEvent === "actor") payload.set(Pubkey.from(encounterOtherOrganism).toBytes(), 1);
    if (payload && options.badEvent === "donor") payload.set(Pubkey.from(encounterOtherOrganism).toBytes(), 33);
    if (payload && options.badEvent === "energy") new DataView(payload.buffer).setBigUint64(77, 123n, true);
    if (payload && options.badEvent === "count") new DataView(payload.buffer).setBigUint64(85, 0n, true);
    return { vmError: failed ? -765 : 0, userErrorCode: failed ? 0xca01000dn : 0n, consumedComputeUnits: 42_501_234, consumedMemoryUnits: 9, consumedStateUnits: 0,
      eventsCount: 1, events: payload && !options.missingEvent ? [{ eventId: "offline-encounter-event", programIdx,
        program: Pubkey.from(options.badEvent === "program" ? encounterOtherWallet : config.programId), payload }] : [] };
  };
  const apply = () => {
    const actor = states.get(encounterActor)!, donor = states.get(encounterDonor)!;
    let different = 0;
    for (let i = 0; i < 32; i++) for (let b = 0; b < 8; b++) if ((actor.genome[i] ^ donor.genome[i]) & (1 << b)) different++;
    const compatibility = 256 - different;
    const outcome = compatibility >= 192 ? 1 : compatibility >= 96 ? 2 : 3;
    const before = actor.energy;
    const changed = before + (outcome === 1 ? 128n : outcome === 2 ? 32n : -96n);
    actor.energy = changed < 0n ? 0n : changed > 65535n ? 65535n : changed;
    if (outcome !== 3) actor.genome[0] = (actor.genome[0] & 0xfe) | (donor.genome[0] & 1);
    actor.count++; actor.seq++; actor.memory.fill(0x79);
    actor.status = actor.vitality === 0n ? 3 : actor.energy < 256n ? 2 : 1;
    const event = new Uint8Array(157), view = new DataView(event.buffer);
    event[0] = 2; event.set(Pubkey.from(encounterActor).toBytes(), 1); event.set(Pubkey.from(encounterDonor).toBytes(), 33);
    view.setUint16(65, compatibility, true); event[67] = outcome; event[68] = outcome === 3 ? 0 : 1;
    view.setBigUint64(69, before, true); view.setBigUint64(77, actor.energy, true); view.setBigUint64(85, actor.count, true);
    event.set(actor.genome, 93); event.set(actor.memory, 125); trace.event = event;
    if (options.laterAction) { actor.energy = 1000n; actor.count++; actor.genome[31] = 0x81; }
  };
  const client = { ...sdk,
    node: { getStatus: async () => ({ ready: options.nodeReady ?? true, locallyExecutedSlot: 50_000n }) },
    accounts: {
      get: async (address: string) => { trace.accountReads++; return record(address); },
      list: async () => ({ accounts: [...states.keys()].map(record), page: {} }),
    },
    transactions: {
      sendAndTrack: async function* (raw: Uint8Array) {
        trace.sends++; trace.submitted = raw;
        if (options.stream !== "failed") apply();
        options.afterSubmission?.();
        if (options.stream === "disconnect") throw new Error("Offline stream disconnected");
        yield { status: 2 };
        if (options.stream !== "accepted") yield { executionResult: execution(options.stream === "failed") };
      },
      getStatus: async (signature: string) => {
        if (signature !== trace.signature) throw new Error("Wrong offline signature");
        trace.statusReads++;
        if (options.status === "unavailable") throw new Error("Offline status unavailable");
        return { executionResult: options.status === "pending" ? undefined : execution(options.status === "failed") };
      },
      get: async (signature: string) => {
        if (signature !== trace.signature || !trace.transaction) throw new Error("Wrong offline transaction");
        trace.transactionReads++;
        const tx = Transaction.fromWire(trace.signed!); tx.slot = 50_000n; tx.executionResult = execution(options.fullFailed) as typeof tx.executionResult;
        if (options.metadataOnly) return { ...tx, instructionData: undefined };
        return tx;
      },
      getRaw: async () => ({ rawTransaction: trace.signed! }),
      listForAccount: async () => ({ transactions: trace.sends && trace.transaction ? [Object.assign(trace.transaction, { executionResult: execution(), slot: 50_000n })] : [], page: {} }),
    },
  } as unknown as Thru;
  const wallet = { connected: true,
    getSigningContext: async () => { trace.contextReads++; return { selectedAccountPublicKey: encounterWallet }; },
    signTransaction: async (intent: ThruTransactionIntent) => {
      trace.approvals++; trace.intents.push(intent);
      if (options.reject) throw new Error("User rejected Encounter approval");
      await options.approvalGate;
      const context = buildWalletAccountContext({ walletAddress: intent.walletAddress!,
        readWriteAccounts: intent.readWriteAddresses!.map(value => Pubkey.from(value).toBytes()), readOnlyAccounts: intent.readOnlyAddresses!.map(value => Pubkey.from(value).toBytes()) });
      const targetData = base64ToBytes(intent.instructionData);
      if (options.badSigned) targetData[0] = 1;
      const tx = new Transaction({ feePayer: encounterFeePayer, program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
        header: { fee: 0n, nonce: BigInt(trace.approvals), startSlot: 50_000n, stateUnits: 0 },
        accounts: { readWriteAccounts: intent.readWriteAddresses, readOnlyAccounts: intent.readOnlyAddresses },
        instructionData: encodeValidateInstruction({ walletAccountIdx: context.walletAccountIdx, authIdx: 0,
          targetInstruction: { programIdx: context.getAccountIndex(Pubkey.from(config.programId).toBytes()), instructionData: targetData },
          signatureR: new Uint8Array(32).fill(1), signatureS: new Uint8Array(32).fill(2), authenticatorData: new Uint8Array(37),
          clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get","origin":"https://test.invalid"}') }),
      });
      await tx.sign(testKey);
      trace.transaction = tx; trace.signed = tx.toWire(); trace.signature = tx.getSignature()!.toThruFmt();
      options.afterApproval?.();
      return bytesToBase64(trace.signed);
    },
  };
  return { client, wallet, trace, states, record, options };
}
