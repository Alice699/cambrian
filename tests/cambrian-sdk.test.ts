import assert from "node:assert/strict";
import test from "node:test";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decodeCambrianOrganism,
  encodeBirthInstruction,
  utf8ToBytes32,
} from "../packages/cambrian-sdk/src/abi.ts";
import { assertBirthDeployment } from "../packages/cambrian-sdk/src/deployment.ts";

test("encodes birth instruction with the documented little-endian layout", () => {
  const seed = new Uint8Array(32).fill(0x11);
  const entropy = new Uint8Array(32).fill(0x22);
  const proof = new Uint8Array([0xaa, 0xbb, 0xcc]);
  const encoded = encodeBirthInstruction({
    organismAccountIndex: 7,
    seed,
    entropy,
    proof,
  });
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

  assert.equal(encoded.length, 74);
  assert.equal(encoded[0], 0);
  assert.equal(view.getUint16(1, true), 7);
  assert.deepEqual(encoded.slice(3, 35), seed);
  assert.deepEqual(encoded.slice(35, 67), entropy);
  assert.equal(view.getUint32(67, true), 3);
  assert.deepEqual(encoded.slice(71), proof);
});

test("round-trips byte helpers without changing binary data", () => {
  const source = new Uint8Array([0, 1, 127, 128, 254, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(source)), source);
  assert.equal(bytesToHex(source), "00017f80feff");
});

test("pads a UTF-8 seed to exactly 32 bytes", () => {
  const seed = utf8ToBytes32("first-light");
  assert.equal(seed.length, 32);
  assert.equal(new TextDecoder().decode(seed.slice(0, 11)), "first-light");
  assert.ok(seed.slice(11).every((byte) => byte === 0));
});

test("decodes the Cambrian organism account layout", () => {
  const bytes = new Uint8Array(264);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x434d4231, true);
  view.setUint8(4, 1);
  view.setUint8(5, 2);
  view.setUint16(6, 9, true);
  view.setBigUint64(200, 100n, true);
  view.setBigUint64(208, 120n, true);
  view.setBigUint64(216, 20n, true);
  view.setBigUint64(224, 84n, true);
  view.setBigUint64(232, 92n, true);
  view.setBigUint64(240, 12n, true);
  view.setBigUint64(248, 3n, true);
  view.setBigUint64(256, 1n, true);

  const state = decodeCambrianOrganism(bytes);

  assert.equal(state.magic, 0x434d4231);
  assert.equal(state.version, 1);
  assert.equal(state.status, 2);
  assert.equal(state.generation, 9);
  assert.equal(state.bornSlot, 100n);
  assert.equal(state.lastPulseSlot, 120n);
  assert.equal(state.energy, 84n);
  assert.equal(state.vitality, 92n);
  assert.equal(state.pulseCount, 12n);
  assert.equal(state.encounterCount, 3n);
  assert.equal(state.offspringCount, 1n);
});

test("rejects malformed organism account data", () => {
  assert.throws(() => decodeCambrianOrganism(new Uint8Array(263)), /at least 264 bytes/);
  assert.throws(
    () => encodeBirthInstruction({
      seed: new Uint8Array(31),
      entropy: new Uint8Array(32),
      proof: new Uint8Array(),
    }),
    /seed must be exactly 32 bytes/,
  );
});

test("does not allow a birth transaction before deployment IDs are configured", () => {
  assert.throws(
    () => assertBirthDeployment({
      network: "betanet",
      rpcUrl: "https://rpc.betanet.thru.org",
      walletIframeUrl: "https://app.tid.sh/embedded",
      explorerUrl: "https://scan.thru.org",
      programId: "",
      abiId: "",
    }),
    /program ID is not configured yet/,
  );
});
