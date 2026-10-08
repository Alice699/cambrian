import assert from "node:assert/strict";
import test from "node:test";
import { Pubkey, type Thru } from "@thru/sdk";
import { defaultCambrianConfig as config } from "../packages/config/src/index.ts";
import { listWalletCambrianOrganisms, isOrganismControlledBy, readOrganism } from "../packages/cambrian-sdk/src/read-service.ts";
import { prepareBirthIntent } from "../packages/cambrian-sdk/src/client.ts";
import { encodeBirthInstruction } from "../packages/cambrian-sdk/src/abi.ts";
import { confirmBirthTransaction, type BirthTransactionUpdate } from "../packages/cambrian-sdk/src/transaction-service.ts";
import { confirmedBirthAccount as fixture } from "./fixtures/confirmed-birth-account.ts";
import { confirmedWalletBirthAccount as managedFixture } from "./fixtures/confirmed-wallet-birth-account.ts";

const walletA = Pubkey.from(new Uint8Array(32).fill(0x44)).toThruFmt();
const walletB = Pubkey.from(new Uint8Array(32).fill(0x55)).toThruFmt();
const walletC = Pubkey.from(new Uint8Array(32).fill(0x66)).toThruFmt();
const address = (byte: number) => Pubkey.from(new Uint8Array(32).fill(byte)).toThruFmt();
function account(controller: string, id: number) {
  const data = fixture.data.slice();
  data.set(Pubkey.from(controller).toBytes(), 8);
  return { address: Pubkey.from(address(id)), meta: { owner: Pubkey.from(config.programId), dataSize: 264, balance: 0n }, data: { data, compressed: false } };
}
function clientFor(pages: ReturnType<typeof account>[][]) {
  const calls: (string | undefined)[] = [];
  const client = {
    helpers: { createPubkey: (value: string) => Pubkey.from(value) },
    accounts: {
      list: async ({ page }: { page: { pageToken?: string } }) => {
        calls.push(page.pageToken);
        const index = Number(page.pageToken ?? 0);
        return { accounts: pages[index], page: { nextPageToken: index + 1 < pages.length ? String(index + 1) : undefined } };
      },
      get: async (value: string) => pages.flat().find(item => item.address.toThruFmt() === value),
    },
  } as unknown as Thru;
  return { client, calls };
}

test("wallet A and B see only their own controllers; wallet C has a genuine empty collection", async () => {
  const { client } = clientFor([[account(walletA, 0x71), account(walletB, 0x72), account(fixture.controller, 0x73)]]);
  assert.deepEqual((await listWalletCambrianOrganisms(client, config, walletA)).organisms.map(item => item.address), [address(0x71)]);
  assert.deepEqual((await listWalletCambrianOrganisms(client, config, walletB)).organisms.map(item => item.address), [address(0x72)]);
  assert.deepEqual((await listWalletCambrianOrganisms(client, config, walletC)).organisms, []);
});

test("ownership lookup reads later index pages rather than showing a false empty first page", async () => {
  const { client, calls } = clientFor([[account(walletB, 0x71)], [account(walletA, 0x72)]]);
  assert.equal((await listWalletCambrianOrganisms(client, config, walletA)).organisms[0].address, address(0x72));
  assert.deepEqual(calls, [undefined, "1"]);
});

test("fee-payer-controlled legacy organisms are not claimed by a selected managed wallet", async () => {
  const { client } = clientFor([[account(fixture.controller, 0x71)]]);
  const record = await readOrganism(client, address(0x71));
  assert.equal(isOrganismControlledBy(record, walletA), false);
  assert.equal(isOrganismControlledBy(record, fixture.controller), true);
});

test("real wallet Birth and legacy Birth remain isolated by their actual stored controllers", async () => {
  const legacy = { ...account(fixture.controller, 0x71), address: Pubkey.from(fixture.address), data: { data: fixture.data.slice(), compressed: false } };
  const managed = { ...account(managedFixture.controller, 0x72), address: Pubkey.from(managedFixture.address), data: { data: managedFixture.data.slice(), compressed: false } };
  const { client } = clientFor([[legacy, managed]]);
  const record = await readOrganism(client, managedFixture.address);
  assert.equal(managedFixture.data.length, 264);
  assert.equal(record.state.bornSlot, 622115n);
  assert.equal(record.state.energy, 2048n);
  assert.equal(record.state.vitality, 975n);
  assert.equal(record.state.pulseCount, 0n);
  assert.equal(Pubkey.from(record.state.controller).toThruFmt(), managedFixture.controller);
  assert.notEqual(managedFixture.controller, managedFixture.feePayer);
  assert.equal(isOrganismControlledBy(record, managedFixture.feePayer), false);
  assert.deepEqual((await listWalletCambrianOrganisms(client, config, managedFixture.controller)).organisms.map(item => item.address), [managedFixture.address]);
  assert.deepEqual((await listWalletCambrianOrganisms(client, config, managedFixture.feePayer)).organisms.map(item => item.address), [fixture.address]);
  assert.deepEqual((await listWalletCambrianOrganisms(client, config, walletC)).organisms, []);
});

test("confirmed real wallet Birth becomes readable only for the intended managed controller without resubmission", async () => {
  const { client } = clientFor([[{ ...account(managedFixture.controller, 0x72), address: Pubkey.from(managedFixture.address), data: { data: managedFixture.data.slice(), compressed: false } }]]);
  client.transactions = {
    sendAndTrack: () => { throw new Error("A confirmed Birth must never be resubmitted"); },
    getStatus: () => { throw new Error("An already-confirmed receipt needs only account reads"); },
  } as unknown as Thru["transactions"];
  for (const controller of [managedFixture.controller, managedFixture.feePayer]) {
    const updates: BirthTransactionUpdate[] = [];
    const result = await confirmBirthTransaction(client, config, {
      stage: "confirmed", signature: managedFixture.signature,
      prepared: {
        organismAddress: managedFixture.address,
        seed: new Uint8Array(32), entropy: new Uint8Array(32), proof: new Uint8Array(),
        intent: { programAddress: config.programId, walletAddress: controller, instructionData: "", review: { instruction: "wallet_birth" } },
      },
    }, { organismTimeoutMs: 0, onUpdate: update => updates.push(update) });
    assert.equal(result.signature, managedFixture.signature);
    if (controller === managedFixture.controller) {
      assert.equal(result.organism?.address, managedFixture.address);
      assert.equal(result.slot, 622115n);
      assert.deepEqual(updates.map(update => update.stage), ["syncing", "confirmed"]);
    } else {
      assert.equal(result.organism, undefined);
      assert.deepEqual(updates.map(update => update.stage), ["syncing"]);
    }
  }
});

test("cancelled wallet discovery performs no network read", async () => {
  const { client, calls } = clientFor([[account(walletA, 0x71)]]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => listWalletCambrianOrganisms(client, config, walletA, { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(calls, []);
});

test("bounded pagination reports an incomplete read instead of asserting empty", async () => {
  const { client } = clientFor([[account(walletB, 0x71)], [account(walletA, 0x72)]]);
  await assert.rejects(() => listWalletCambrianOrganisms(client, config, walletA, { maxPages: 1 }), /empty collection has not been confirmed/);
});

test("duplicate pagination tokens fail clearly", async () => {
  const { client } = clientFor([[account(walletB, 0x71)]]);
  client.accounts.list = async () => ({ accounts: [account(walletB, 0x71)], page: { nextPageToken: "repeat" } }) as never;
  await assert.rejects(() => listWalletCambrianOrganisms(client, config, walletA), /repeated a page/);
});

test("wallet Birth is blocked before proof generation or approval until the upgraded program is enabled", async () => {
  const client = { proofs: { generate: () => { throw new Error("must not fetch a proof"); } } } as unknown as Thru;
  await assert.rejects(() => prepareBirthIntent(client, { ...config, walletBirthEnabled: false }, { walletAddress: walletA, seed: "owned-birth", signingMode: "thru-wallet" }), /awaiting the program upgrade/);
});

test("wallet_birth encodes both account indices without changing legacy Birth bytes", () => {
  const fields = { organismAccountIndex: 3, seed: new Uint8Array(32).fill(1), entropy: new Uint8Array(32).fill(2), proof: new Uint8Array([9, 8]) };
  const legacy = encodeBirthInstruction(fields);
  const managed = encodeBirthInstruction({ ...fields, controllerAccountIndex: 2 });
  assert.equal(legacy[0], 0); assert.equal(managed[0], 5);
  assert.equal(managed.length, 75);
  assert.equal(new DataView(managed.buffer).getUint16(3, true), 2);
  assert.deepEqual(managed.slice(5), legacy.slice(3));
});

test("managed Birth rejects the fee payer, program, same organism, and invalid controller indices", () => {
  for (const index of [0, 1, 3, -1, 65_536, 2.5]) {
    assert.throws(() => encodeBirthInstruction({ organismAccountIndex: 3, controllerAccountIndex: index, seed: new Uint8Array(32), entropy: new Uint8Array(32), proof: new Uint8Array([1]) }), /distinct managed wallet/);
  }
});
