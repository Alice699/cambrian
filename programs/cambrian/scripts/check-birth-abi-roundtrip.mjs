import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { encodeBirthInstruction, utf8ToBytes32 } from "../../../packages/cambrian-sdk/src/abi.ts";

// Offline synthetic payloads only: these are not state proofs or signed transactions.
// Compare the dapp's encoder with the official CLI-generated ABI builders.
const artifacts = new URL("../build/release-verification/", import.meta.url);
const server = await createServer({
  root: fileURLToPath(new URL("../../../", import.meta.url)), configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "silent",
});
let generated;
try { generated = await server.ssrLoadModule("/programs/cambrian/build/release-verification/generated/cambrian/lifeform/types.ts"); }
finally { await server.close(); }
const fixtures = new URL("roundtrip/", artifacts);
await mkdir(fixtures, { recursive: true });
let checks = 0;
for (const [controllerAccountIndex, organismAccountIndex] of [[2, 3], [4, 2], [65535, 65534], [undefined, 2]]) {
  for (const proofSize of [1, 17, 104]) {
    const seed = utf8ToBytes32("offline-wallet-birth-check");
    const entropy = Uint8Array.from({ length: 32 }, (_value, index) => 255 - index);
    const proof = Uint8Array.from({ length: proofSize }, (_value, index) => (index + 1) & 255);
    const managed = controllerAccountIndex !== undefined;
    const body = (managed ? generated.WalletBirthArgs : generated.BirthArgs).builder()
      .set_organism_account_idx(organismAccountIndex).set_seed(seed).set_entropy(entropy);
    if (managed) body.set_controller_account_idx(controllerAccountIndex);
    body.proof().write(proof).finish();
    const instruction = generated.CambrianInstruction.builder();
    instruction.payload().select(managed ? "wallet_birth" : "birth").writePayload(body).finish();
    const generatedBytes = instruction.build();
    const sdkBytes = encodeBirthInstruction({ controllerAccountIndex, organismAccountIndex, seed, entropy, proof });
    assert.deepEqual(generatedBytes, sdkBytes, "SDK and generated ABI instruction layouts differ");
    const decoded = instruction.finish().payload();
    const args = managed ? decoded.asWalletBirth() : decoded.asBirth();
    assert.ok(args);
    assert.equal(args.organism_account_idx, organismAccountIndex);
    if (managed) assert.equal(args.controller_account_idx, controllerAccountIndex);
    assert.equal(args.proof_size, proofSize);
    await writeFile(new URL(`${managed ? "wallet-birth" : "legacy-birth"}-${organismAccountIndex}-${proofSize}.bin`, fixtures), generatedBytes);
    checks++;
  }
}
console.log(`${checks} SDK ↔ official generated ABI byte roundtrips passed. CLI reflection fixtures are in programs/cambrian/build/release-verification/roundtrip/.`);
