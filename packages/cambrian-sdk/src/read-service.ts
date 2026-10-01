import {
  AccountView,
  Filter,
  FilterParamValue,
  PageRequest,
  type Account,
  type Thru,
} from "@thru/sdk";
import type { CambrianConfig } from "@cambrian/config";
import { decodeCambrianOrganism, type CambrianOrganismState } from "./abi.js";

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

export interface CambrianTransactionSummary {
  signature: string | null;
  feePayer: string;
  program: string;
  slot: bigint | null;
  instructionBytes: number;
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
      organisms.push(decodeOrganismAccount(account));
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

export async function listAccountTransactions(
  client: Thru,
  address: string,
  options: { pageSize?: number; pageToken?: string } = {},
): Promise<CambrianTransactionList> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
  const response = await client.transactions.listForAccount(address, {
    page: new PageRequest({
      pageSize,
      pageToken: options.pageToken,
    }),
  });

  return {
    transactions: response.transactions.map((transaction) => ({
      signature: transaction.getSignature()?.toThruFmt() ?? null,
      feePayer: transaction.feePayer.toThruFmt(),
      program: transaction.program.toThruFmt(),
      slot: transaction.slot ?? null,
      instructionBytes: transaction.instructionData?.length ?? transaction.instructionDataSize ?? 0,
    })),
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
