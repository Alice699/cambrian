import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createThruClient } from "@thru/sdk/client";
import { AccountView } from "@thru/sdk";
import { inspectProgramDeployment } from "@thru/programs/deploy";
import { parseABIAccount } from "@thru/programs/abi-manager";
import { validateManagerProgramImage } from "@thru/programs/manager";

// Read-only chain verification. No signer, private key, or submission API is used.
// Deliberately pinned to this release; another upgrade needs a reviewed plan.
const phase = process.argv[2];
assert.ok(["before", "after"].includes(phase), "Use before or after; this script never deploys");
const rpcUrl = "https://rpc.betanet.thru.org";
const seed = "cambrian-3de2abdb68f5148a";
const programAddress = "taLnTXq4qblEsC-HkN4QG35Lp72Vnle8gk8UkiAtASymFD";
const abiAddress = "taPciIseW9AzTnNaB6VJyhHkiOwEDfZYwUbdPdfvbvUQuS";
const authorityAddress = "ta2DWL8RL2priv0KspU5eToHOr43TMJORs5TnTyD6ItHzD";
const programSha256 = "740bc05457020262c199b02b908817632d7fa054ef95608e3c398f705ffa615c";
const abiSha256 = "750263e8b8d0eaa84dfa6480fdbf9c76a60ea35fa16dcde6c09b926bfbc4efac";
const legacyProgramSha256 = "9b22018403f4ca745e22b5f13a71b63e7f01423fc75af18423d3f89d5f3359ad";
const artifacts = new URL("../build/release-verification/", import.meta.url);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const stringify = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);

async function archiveOnce(name, bytes) {
  const target = new URL(name, artifacts);
  try { await writeFile(target, bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    assert.deepEqual(await readFile(target), Buffer.from(bytes), `Refusing to overwrite a different ${name} backup`);
  }
}

const [program, abi] = await Promise.all([
  readFile(new URL("thruvm/bin/cambrian_c.bin", artifacts)),
  readFile(new URL("cambrian.publish.abi.yaml", artifacts)),
]);
assert.equal(hash(program), programSha256, "Candidate binary differs from the reviewed build");
assert.equal(hash(abi), abiSha256, "Candidate ABI differs from the reviewed publish artifact");
validateManagerProgramImage(program);
const client = createThruClient({ baseUrl: rpcUrl });
const inspection = await inspectProgramDeployment({
  client, seed, authorityAddress, inspectABI: true,
  expectedProgramBytes: program, expectedABIBytes: abi,
});
assert.equal(inspection.programAccountAddress, programAddress, "Seed targets a different program");
assert.equal(inspection.abiAccountAddress, abiAddress, "ABI targets a different deployment");
assert.equal(inspection.program.status, "present", "Program pair is missing or partial");
assert.equal(inspection.abi?.status, "present", "ABI pair is missing or partial");
assert.equal(inspection.program.state, 0, "Program is paused or finalized");
assert.equal(inspection.abi.state, 0, "ABI is finalized");
let previousArtifactHashes;
if (phase === "before") {
  assert.equal(inspection.program.version, 0n, "Unexpected baseline program version; review before any upgrade");
  assert.equal(inspection.abi.revision, 0n, "Unexpected baseline ABI revision; review before any upgrade");
  const [programAccount, abiAccount] = await Promise.all([
    client.accounts.get(programAddress, { view: AccountView.FULL }),
    client.accounts.get(abiAddress, { view: AccountView.FULL }),
  ]);
  const previousProgram = programAccount.data?.data;
  assert.ok(previousProgram?.length, "Baseline program bytes are unavailable");
  assert.equal(hash(previousProgram), legacyProgramSha256, "Live baseline differs from the previously verified program");
  const previousABI = parseABIAccount(abiAccount).contents;
  assert.ok(previousABI.length, "Baseline ABI content is unavailable");
  await archiveOnce("legacy-program.bin", previousProgram);
  await archiveOnce("legacy.abi.yaml", previousABI);
  previousArtifactHashes = { program: hash(previousProgram), abi: hash(previousABI) };
} else {
  assert.equal(inspection.program.version, 1n, "Expected exactly one program upgrade");
  assert.equal(inspection.abi.revision, 1n, "Expected exactly one ABI upgrade");
  assert.equal(inspection.program.bytesMatch, true, "On-chain binary does not match the reviewed build");
  assert.equal(inspection.abi.bytesMatch, true, "On-chain ABI does not match the reviewed publish artifact");
}
const report = {
  phase, checkedAt: new Date().toISOString(), rpcUrl, seed, authorityAddress,
  programSha256, abiSha256, previousArtifactHashes, inspection,
};
await writeFile(new URL(`${phase}-verification.json`, artifacts), stringify(report) + "\n");
console.log(stringify(report));
