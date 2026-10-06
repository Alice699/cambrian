import assert from "node:assert/strict";
import test from "node:test";
import { AccountView, Pubkey, type Thru } from "@thru/sdk";
import { defaultCambrianConfig as config } from "../packages/config/src/index.ts";
import { decodeCambrianOrganism } from "../packages/cambrian-sdk/src/abi.ts";
import { listAccountTransactions, listCambrianOrganisms, readOrganism } from "../packages/cambrian-sdk/src/read-service.ts";
import { confirmBirthTransaction, type BirthTransactionUpdate } from "../packages/cambrian-sdk/src/transaction-service.ts";
import { confirmedBirthAccount as fixture } from "./fixtures/confirmed-birth-account.ts";

function fullAccount(owner = config.programId) {
  return {
    address: Pubkey.from(fixture.address),
    meta: { owner: Pubkey.from(owner), dataSize: 264, balance: 0n, nonce: 0n, seq: 1n },
    data: { data: fixture.data.slice(), compressed: false },
  };
}

function readClient(options: { fullList?: boolean; failingRead?: boolean; wrongOwner?: boolean } = {}) {
  const account = fullAccount(options.wrongOwner ? fixture.controller : config.programId);
  const reads: string[] = [];
  const client = {
    helpers: { createPubkey: (address: string) => Pubkey.from(address) },
    accounts: {
      list: async ({ view }: { view: AccountView }) => {
        assert.equal(view, AccountView.FULL);
        return {
          accounts: [options.fullList ? account : { address: account.address, meta: account.meta }],
          page: { nextPageToken: "next-page" },
        };
      },
      get: async (address: string | Pubkey, { view }: { view: AccountView }) => {
        const key = Pubkey.from(address).toThruFmt();
        reads.push(key);
        assert.equal(key, fixture.address);
        assert.equal(view, AccountView.FULL);
        if (options.failingRead) throw new Error("Account data temporarily unavailable");
        return account;
      },
    },
    transactions: {
      sendAndTrack: () => { throw new Error("Reading an organism must never submit a transaction"); },
      getStatus: () => { throw new Error("An already-confirmed receipt does not need another execution check"); },
    },
  } as unknown as Thru;
  return { client, reads };
}

test("regression: decodes the real confirmed Birth account header and live state", () => {
  assert.equal(fixture.data.length, 264);
  assert.deepEqual(Array.from(fixture.data.slice(0, 6)), [0x42, 0x4d, 0x41, 0x43, 1, 1]);
  const state = decodeCambrianOrganism(fixture.data);
  assert.equal(state.magic, 0x43414d42);
  assert.equal(state.version, 1);
  assert.equal(state.status, 1);
  assert.equal(state.bornSlot, 467823n);
  assert.equal(state.energy, 2048n);
  assert.equal(state.vitality, 845n);
  assert.equal(Pubkey.from(state.controller).toThruFmt(), fixture.controller);
});

test("activity uses real execution results instead of treating a listed or slotted transaction as successful", async () => {
  const transaction = (vmError: number | undefined, signature: string | null) => ({
    getSignature: () => signature ? { toThruFmt: () => signature } : undefined,
    feePayer: Pubkey.from(fixture.controller), program: Pubkey.from(config.programId),
    slot: 123n, instructionDataSize: 71,
    executionResult: vmError === undefined ? undefined : { vmError },
  });
  const client = { transactions: { listForAccount: async () => ({ transactions: [transaction(0, "ok"), transaction(-763, "failed"), transaction(undefined, "unknown"), transaction(undefined, null)] }) } } as unknown as Thru;
  const result = await listAccountTransactions(client, fixture.controller);
  assert.deepEqual(result.transactions.map(item => item.status), ["confirmed", "failed", "pending", "unavailable"]);
  assert.deepEqual(result.transactions.map(item => item.vmError), [0, -763, null, null]);
});

test("reads a real-layout organism through the FULL account endpoint", async () => {
  const { client, reads } = readClient();
  const record = await readOrganism(client, fixture.address);
  assert.equal(record.address, fixture.address);
  assert.equal(record.owner, config.programId);
  assert.equal(record.state.bornSlot, 467823n);
  assert.deepEqual(reads, [fixture.address]);
});

test("regression: a metadata-only list response is hydrated and survives dashboard refresh", async () => {
  const { client, reads } = readClient();
  const collection = await listCambrianOrganisms(client, config);
  assert.equal(collection.organisms.length, 1);
  assert.equal(collection.organisms[0].address, fixture.address);
  assert.equal(collection.organisms[0].state.energy, 2048n);
  assert.deepEqual(collection.unreadableAccounts, []);
  assert.equal(collection.nextPageToken, "next-page");
  assert.deepEqual(reads, [fixture.address]);
});

test("a full list payload is decoded without unnecessary account reads", async () => {
  const { client, reads } = readClient({ fullList: true });
  const collection = await listCambrianOrganisms(client, config);
  assert.equal(collection.organisms.length, 1);
  assert.deepEqual(reads, []);
});

test("an unavailable account payload remains unreadable rather than a fabricated organism", async () => {
  const { client } = readClient({ failingRead: true });
  const collection = await listCambrianOrganisms(client, config);
  assert.deepEqual(collection.organisms, []);
  assert.deepEqual(collection.unreadableAccounts, [{ address: fixture.address, reason: "Account data temporarily unavailable" }]);
});

test("the collection does not accept an account owned by a different program", async () => {
  const { client } = readClient({ wrongOwner: true });
  const collection = await listCambrianOrganisms(client, config);
  assert.deepEqual(collection.organisms, []);
  assert.match(collection.unreadableAccounts[0].reason, /not owned by the Cambrian program/);
});

test("rejects the old incorrect header and unsupported account versions", () => {
  const oldHeader = fixture.data.slice();
  new DataView(oldHeader.buffer).setUint32(0, 0x434d4231, true);
  assert.throws(() => decodeCambrianOrganism(oldHeader), /invalid Cambrian magic/);
  const futureVersion = fixture.data.slice();
  futureVersion[4] = 2;
  assert.throws(() => decodeCambrianOrganism(futureVersion), /unsupported Cambrian organism version 2/);
});

test("an existing confirmed Birth reaches Read organism without another approval or submission", async () => {
  const { client, reads } = readClient();
  const updates: BirthTransactionUpdate[] = [];
  const result = await confirmBirthTransaction(client, config, {
    stage: "confirmed",
    signature: fixture.signature,
    prepared: {
      organismAddress: fixture.address,
      intent: { programAddress: config.programId, instructionData: "", stateUnits: 1 },
      seed: new Uint8Array(32), entropy: new Uint8Array(32), proof: new Uint8Array(),
    },
  }, { organismTimeoutMs: 0, onUpdate: update => updates.push(update) });
  assert.equal(result.organism?.address, fixture.address);
  assert.equal(result.slot, 467823n);
  assert.equal(result.signature, fixture.signature);
  assert.deepEqual(reads, [fixture.address]);
  assert.deepEqual(updates.map(update => update.stage), ["syncing", "confirmed"]);
});
