import assert from "node:assert/strict";
import test from "node:test";
import { Pubkey, Signature, keys, verifyMessage, type Thru } from "@thru/sdk";
import { selectActiveWallet } from "../apps/web/src/wallet-selection.ts";
import {
  LocalWalletController,
  LocalWalletSession,
  MemoryLocalWalletStorage,
} from "../packages/wallet-core/src/local-wallet.ts";

test("connected Thru Wallet wins over an unlocked local wallet for balance and faucet routing", () => {
  assert.deepEqual(selectActiveWallet(true, "thru-account", "local-account"), {
    provider: "thru", address: "thru-account",
  });
});

test("a stale disconnected Thru account cannot receive a local wallet's faucet request", () => {
  assert.deepEqual(selectActiveWallet(false, "stale-thru-account", "local-account"), {
    provider: "local", address: "local-account",
  });
});

test("locked local wallets and disconnected Thru Wallet have no active faucet target", () => {
  assert.equal(selectActiveWallet(false, "stale-thru-account", null), null);
});

test("Thru Wallet remains selectable when the local vault is locked", () => {
  assert.deepEqual(selectActiveWallet(true, "thru-account", null), {
    provider: "thru", address: "thru-account",
  });
});

test("creates and unlocks an encrypted local Thru wallet", async () => {
  const storage = new MemoryLocalWalletStorage();
  const controller = new LocalWalletController({ rpcUrl: "https://rpc.betanet.thru.org", storage });
  const created = await controller.create("correct horse battery");

  assert.equal(created.recoveryPhrase.split(" ").length, 12);
  assert.match(created.account.address, /^ta/);
  assert.equal(controller.getSnapshot().status, "unlocked");

  const record = await storage.read();
  assert.ok(record);
  assert.equal(JSON.stringify(record).includes(created.recoveryPhrase), false);
  assert.equal(JSON.stringify(record).includes("mnemonic"), false);

  controller.lock();
  assert.equal(controller.getSnapshot().status, "locked");
  await assert.rejects(() => controller.unlock("wrong password"), /Invalid wallet password/);

  const unlocked = await controller.unlock("correct horse battery");
  assert.equal(unlocked.address, created.account.address);
});

test("restores the same account from its recovery phrase and signs messages", async () => {
  const phrase = await (async () => {
    const source = new LocalWalletController({ rpcUrl: "https://rpc.betanet.thru.org", storage: new MemoryLocalWalletStorage() });
    return (await source.create("another secure password")).recoveryPhrase;
  })();

  const restored = new LocalWalletController({ rpcUrl: "https://rpc.betanet.thru.org", storage: new MemoryLocalWalletStorage() });
  const account = await restored.restore(phrase, "another secure password");
  const signer = restored.getSigner();
  assert.ok(signer);

  const message = new TextEncoder().encode("Cambrian local wallet");
  const signature = await signer.signMessage(message);
  const valid = await verifyMessage(
    Signature.from(signature).toBytes(),
    message,
    Pubkey.from(account.publicKey).toBytes(),
  );
  assert.equal(valid, true);
});

test("provisions a missing local account before requesting funds", async () => {
  const keyPair = await keys.generateKeyPair();
  const account = {
    address: keyPair.address,
    publicKey: Pubkey.from(keyPair.publicKey).toThruFmt(),
    path: "m/44'/9999'/0'/0'",
    index: 0,
  };
  let exists = false;
  let createCalls = 0;
  let sendCalls = 0;
  const transaction = {
    async sign(privateKey: Uint8Array) {
      assert.deepEqual(privateKey, keyPair.privateKey);
    },
  };
  const fakeClient = {
    accounts: {
      async get() {
        if (exists) return {};
        const error = new Error("[not_found] account not found") as Error & { code?: number };
        error.code = 5;
        throw error;
      },
      async create() {
        createCalls += 1;
        return transaction;
      },
    },
    transactions: {
      async send() {
        sendCalls += 1;
        exists = true;
        return "sig-account-create";
      },
    },
  } as unknown as Thru;

  const session = new LocalWalletSession(account, fakeClient, keyPair.privateKey);
  assert.deepEqual(await session.ensureAccount(), { created: true, signature: "sig-account-create" });
  assert.deepEqual(await session.ensureAccount(), { created: false });
  assert.equal(createCalls, 1);
  assert.equal(sendCalls, 1);
  session.lock();
});

test("keeps named local wallets switchable inside one encrypted vault", async () => {
  const storage = new MemoryLocalWalletStorage();
  const controller = new LocalWalletController({ rpcUrl: "https://rpc.betanet.thru.org", storage });
  const first = await controller.create("shared vault password", "Main wallet");
  const second = await controller.add("shared vault password", "Savings");

  assert.equal(controller.getSnapshot().wallets.length, 2);
  assert.deepEqual(controller.getSnapshot().wallets.map((wallet) => wallet.name), ["Main wallet", "Savings"]);
  assert.equal(controller.getSnapshot().activeWalletId, second.wallet.id);
  assert.notEqual(first.account.address, second.account.address);

  await controller.switchWallet(first.wallet.id);
  assert.equal(controller.getSnapshot().account?.address, first.account.address);
  await controller.rename(first.wallet.id, "Daily wallet");
  assert.equal(controller.getSnapshot().wallets[0]?.name, "Daily wallet");

  const record = await storage.read();
  assert.ok(record);
  assert.equal(JSON.stringify(record).includes(first.recoveryPhrase), false);
  assert.equal(JSON.stringify(record).includes(second.recoveryPhrase), false);

  controller.lock();
  await controller.unlock("shared vault password");
  assert.equal(controller.getSnapshot().account?.address, first.account.address);
  assert.deepEqual(controller.getSnapshot().wallets.map((wallet) => wallet.name), ["Daily wallet", "Savings"]);
});

test("local transaction signer decodes Thru intent data before using the SDK builder", async () => {
  const keyPair = await keys.generateKeyPair();
  const account = {
    address: keyPair.address,
    publicKey: Pubkey.from(keyPair.publicKey).toThruFmt(),
    path: "m/44'/9999'/0'/0'",
    index: 0,
  };
  let capturedInstructionData: Uint8Array | undefined;
  let capturedStateUnits: number | undefined;
  const fakeClient = {
    transactions: {
      buildAndSign: async (options: { instructionData?: Uint8Array; header?: { stateUnits?: number } }) => {
        capturedInstructionData = options.instructionData;
        capturedStateUnits = options.header?.stateUnits;
        return { rawTransaction: new Uint8Array([0xaa, 0xbb]) };
      },
    },
  } as unknown as Thru;
  const session = new LocalWalletSession(account, fakeClient, keyPair.privateKey);
  const rawIntentData = new Uint8Array([0, 1, 127, 128, 255]);
  let binary = "";
  rawIntentData.forEach((byte) => { binary += String.fromCharCode(byte); });

  const signed = await session.signTransaction({
    walletAddress: account.address,
    programAddress: account.address,
    instructionData: btoa(binary),
    stateUnits: 1,
  });

  assert.deepEqual(capturedInstructionData, rawIntentData);
  assert.equal(capturedStateUnits, 1);
  assert.equal(signed, btoa(String.fromCharCode(0xaa, 0xbb)));
  session.lock();
  await assert.rejects(() => session.signMessage(new Uint8Array([1])), /Local wallet is locked/);
});
