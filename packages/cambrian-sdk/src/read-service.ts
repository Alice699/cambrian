import {
  AccountView,
  Filter,
  FilterParamValue,
  PageRequest,
  Pubkey,
  TransactionView,
  type Account,
  type Thru,
} from "@thru/sdk";
import type { CambrianConfig } from "@cambrian/config";
import { decodeCambrianOrganism, type CambrianOrganismState } from "./abi.js";
import { identifyAccountTransaction, type AccountTransactionActivity } from "./activity.js";

export interface CambrianAccountSnapshot {
  address: string;
  balance: bigint | null;
  dataSize: number;
  owner: string | null;
  nonce: bigint | null;
  sequence: bigint | null;
  lastUpdatedSlot: bigint | null;
  data?: Uint8Array;
}

export interface CambrianOrganismRecord extends CambrianAccountSnapshot {
  state: CambrianOrganismState;
}

export interface CambrianOrganismList {
  organisms: CambrianOrganismRecord[];
  unreadableAccounts: Array<{ address: string; reason: string }>;
  nextPageToken?: string;
}

export function isOrganismControlledBy(organism: CambrianOrganismRecord, address: string): boolean {
  const controller = organism.state.controller;
  return Pubkey.from(controller).toThruFmt() === Pubkey.from(address).toThruFmt();
}

export interface CambrianTransactionSummary {
  signature: string | null;
  feePayer: string;
  program: string;
  slot: bigint | null;
  instructionBytes: number;
  status: "confirmed" | "pending" | "failed" | "unavailable";
  vmError: number | null;
  activity: AccountTransactionActivity;
}

export interface CambrianTransactionList {
  transactions: CambrianTransactionSummary[];
  nextPageToken?: string;
}

export function toAccountSnapshot(account: Account): CambrianAccountSnapshot {
  return {
    address: account.address.toThruFmt(),
    balance: account.meta?.balance ?? null,
    dataSize: account.meta?.dataSize ?? 0,
    owner: account.meta?.owner?.toThruFmt() ?? null,
    nonce: account.meta?.nonce ?? null,
    sequence: account.meta?.seq ?? null,
    lastUpdatedSlot: null,
    data: account.data?.data,
  };
}

export async function readAccountSnapshot(
  client: Thru,
  address: string,
  options: { includeData?: boolean } = {},
): Promise<CambrianAccountSnapshot> {
  const account = await client.accounts.get(address, {
    view: options.includeData ? AccountView.FULL : AccountView.META_ONLY,
  });
  return toAccountSnapshot(account);
}

export async function readOrganism(
  client: Thru,
  address: string,
): Promise<CambrianOrganismRecord> {
  const account = await client.accounts.get(address, { view: AccountView.FULL });
  return decodeOrganismAccount(account);
}

export async function listCambrianOrganisms(
  client: Thru,
  config: CambrianConfig,
  options: { pageSize?: number; pageToken?: string } = {},
): Promise<CambrianOrganismList> {
  if (!config.programId) {
    throw new Error("Cambrian program ID is not configured yet");
  }

  const program = client.helpers.createPubkey(config.programId);
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
  const response = await client.accounts.list({
    view: AccountView.FULL,
    filter: new Filter({
      expression: "account.meta.owner.value == params.owner_bytes",
      params: {
        owner_bytes: FilterParamValue.bytes(program.toBytes()),
      },
    }),
    page: new PageRequest({
      pageSize,
      pageToken: options.pageToken,
    }),
  });

  const organisms: CambrianOrganismRecord[] = [];
  const unreadableAccounts: CambrianOrganismList["unreadableAccounts"] = [];

  for (const account of response.accounts) {
    try {
      // Betanet list responses can omit account data even with FULL requested.
      // Hydrate the listed address instead of treating an existing organism as missing.
      const complete = account.data?.data?.length
        ? account
        : await client.accounts.get(account.address, { view: AccountView.FULL });
      const organism = decodeOrganismAccount(complete);
      if (organism.owner !== config.programId) throw new Error("organism account is not owned by the Cambrian program");
      organisms.push(organism);
    } catch (error) {
      unreadableAccounts.push({
        address: account.address.toThruFmt(),
        reason: error instanceof Error ? error.message : "Unknown account layout",
      });
    }
  }

  return {
    organisms,
    unreadableAccounts,
    nextPageToken: response.page?.nextPageToken,
  };
}

/** Wallet-scoped discovery. Program owner and wallet controller are different fields. */
export async function listWalletCambrianOrganisms(
  client: Thru,
  config: CambrianConfig,
  walletAddress: string,
  options: { signal?: AbortSignal; maxPages?: number } = {},
): Promise<CambrianOrganismList> {
  // Validate before any RPC. Never fall back to global discovery on disconnect.
  const address = Pubkey.from(walletAddress).toThruFmt();
  const organisms: CambrianOrganismRecord[] = [];
  const unreadableAccounts: CambrianOrganismList["unreadableAccounts"] = [];
  const seenAddresses = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  const maxPages = Math.min(100, Math.max(1, options.maxPages ?? 50));
  for (let page = 0; page < maxPages; page += 1) {
    options.signal?.throwIfAborted();
    const result = await listCambrianOrganisms(client, config, { pageSize: 100, pageToken });
    options.signal?.throwIfAborted();
    for (const organism of result.organisms) {
      if (isOrganismControlledBy(organism, address) && !seenAddresses.has(organism.address)) {
        organisms.push(organism);
        seenAddresses.add(organism.address);
      }
    }
    unreadableAccounts.push(...result.unreadableAccounts);
    pageToken = result.nextPageToken;
    if (!pageToken) return { organisms, unreadableAccounts };
    if (seenTokens.has(pageToken)) throw new Error("The organism index repeated a page. Please retry the read.");
    seenTokens.add(pageToken);
  }
  throw new Error("The organism index could not be fully checked. Please retry; an empty collection has not been confirmed.");
}

export async function listAccountTransactions(
  client: Thru,
  address: string,
  options: { pageSize?: number; pageToken?: string; cambrianProgramId?: string; signal?: AbortSignal } = {},
): Promise<CambrianTransactionList> {
  options.signal?.throwIfAborted();
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
  const response = await client.transactions.listForAccount(address, {
    transactionOptions: { view: TransactionView.FULL },
    page: new PageRequest({
      pageSize,
      pageToken: options.pageToken,
    }),
  });

  options.signal?.throwIfAborted();
  const transactions: CambrianTransactionSummary[] = [];
  // Some index responses contain metadata only. Hydrate in small read-only batches;
  // a failed detail lookup must not erase its public receipt or confirmation status.
  for (let offset = 0; offset < response.transactions.length; offset += 4) {
    options.signal?.throwIfAborted();
    const batch = await Promise.all(response.transactions.slice(offset, offset + 4).map(async listed => {
      let transaction = listed;
      const signature = listed.getSignature()?.toThruFmt();
      if (!listed.instructionData?.length && signature) {
        try {
          const full = await client.transactions.get(signature, { view: TransactionView.FULL });
          if (full.getSignature()?.toThruFmt() === signature) transaction = full;
        } catch { /* Keep the listed receipt; details remain explicitly unavailable. */ }
      }
      const execution = transaction.executionResult ?? listed.executionResult;
      const status = execution ? execution.vmError === 0 ? "confirmed" as const : "failed" as const
        : signature ? "pending" as const : "unavailable" as const;
      return {
        signature: transaction.getSignature()?.toThruFmt() ?? null,
        feePayer: transaction.feePayer.toThruFmt(),
        program: transaction.program.toThruFmt(),
        slot: transaction.slot ?? listed.slot ?? null,
        instructionBytes: transaction.instructionData?.length ?? transaction.instructionDataSize ?? 0,
        status,
        vmError: execution?.vmError ?? null,
        activity: identifyAccountTransaction(transaction, { walletAddress: address, cambrianProgramId: options.cambrianProgramId, confirmed: status === "confirmed" }),
      };
    }));
    options.signal?.throwIfAborted();
    transactions.push(...batch);
  }
  return {
    transactions,
    nextPageToken: response.page?.nextPageToken,
  };
}

function decodeOrganismAccount(account: Account): CambrianOrganismRecord {
  const snapshot = toAccountSnapshot(account);
  if (!snapshot.data) {
    throw new Error("organism account has no data payload");
  }
  if (account.data?.compressed) {
    throw new Error("organism account data is compressed and cannot be decoded locally");
  }

  return {
    ...snapshot,
    state: decodeCambrianOrganism(snapshot.data),
  };
}
