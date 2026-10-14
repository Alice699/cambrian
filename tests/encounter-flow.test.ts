import assert from "node:assert/strict";
import test from "node:test";
import { Transaction, Pubkey } from "@thru/sdk";
import { defaultCambrianConfig as config } from "../packages/config/src/index.ts";
import { base64ToBytes, bytesToHex, decodeEncounterEvent, encodeEncounterInstruction } from "../packages/cambrian-sdk/src/abi.ts";
import { genomeCompatibility, encounterEligibility, encounterPreview } from "../packages/cambrian-sdk/src/encounter-model.ts";
import { prepareEncounterIntent, executeEncounterTransaction, confirmEncounterTransaction, matchesEncounterTransaction, EncounterExecutionError, type EncounterTransactionUpdate } from "../packages/cambrian-sdk/src/encounter-service.ts";
import { readOrganism } from "../packages/cambrian-sdk/src/read-service.ts";
import { identifyAccountTransaction } from "../packages/cambrian-sdk/src/activity.ts";
import { savePendingEncounter, loadPendingEncounter, clearPendingEncounter } from "../apps/web/src/encounter-receipts.ts";
import { createEncounterHarness, encounterActor, encounterDonor, encounterWallet, encounterOtherWallet, encounterFeePayer, type EncounterHarnessOptions } from "./fixtures/encounter-harness.ts";

const fast = { confirmationTimeoutMs: 0, organismTimeoutMs: 0, pollIntervalMs: 0 };
const options = { ...fast, walletAddress: encounterWallet, actorAddress: encounterActor, donorAddress: encounterDonor, catalyst: 0xf123456789abcdefn };

test("Encounter uses the C tag and packed two-u16/u64 format without precision loss", () => {
  assert.deepEqual(Array.from(encodeEncounterInstruction(0x1234, 0x5678, options.catalyst)), [2, 0x34, 0x12, 0x78, 0x56, 0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0xf1]);
  for (const index of [0, 1, -1, 65536, 2.1]) assert.throws(() => encodeEncounterInstruction(index, 3, 0n));
  assert.throws(() => encodeEncounterInstruction(2, 2, 0n));
  for (const catalyst of [-1n, 0x10000000000000000n, 12 as unknown as bigint]) assert.throws(() => encodeEncounterInstruction(2, 3, catalyst));
});

test("genome comparison uses all 256 bits and rejects incomplete genomes", () => {
  assert.equal(genomeCompatibility(new Uint8Array(32), new Uint8Array(32)), 256);
  assert.equal(genomeCompatibility(new Uint8Array(32), new Uint8Array(32).fill(255)), 0);
  const last = new Uint8Array(32); last[31] = 0x80;
  assert.equal(genomeCompatibility(new Uint8Array(32), last), 255);
  assert.throws(() => genomeCompatibility(new Uint8Array(31), last));
});

for (const [bits, outcome, delta] of [[64, "symbiosis", 128n], [65, "adaptation", 32n], [160, "adaptation", 32n], [161, "stress", -96n]] as const) {
  test(`Encounter forecast matches the C tier boundary at ${256 - bits} matching bits`, async () => {
    const fixture = createEncounterHarness({ donorBits: bits });
    const actor = await readOrganism(fixture.client, encounterActor), donor = await readOrganism(fixture.client, encounterDonor);
    const preview = encounterPreview(actor, donor);
    assert.equal(preview.compatibility, 256 - bits); assert.equal(preview.outcome, outcome); assert.equal(preview.energyDelta, delta);
    assert.equal(preview.geneCopyPossible, outcome !== "stress");
    assert.equal(encounterEligibility(actor, donor, config, encounterWallet).allowed, true);
  });
}

test("preview caps energy at 65,535, floors stress at zero and predicts dormant status", async () => {
  for (const [energy, donorBits, after, status] of [[65530n, 0, 65535n, 1], [40n, 256, 0n, 2], [300n, 256, 204n, 2]] as const) {
    const fixture = createEncounterHarness({ energy, donorBits });
    const preview = (await prepareEncounterIntent(fixture.client, config, options)).preview;
    assert.equal(preview.energyAfter, after); assert.equal(preview.statusAfter, status);
  }
});

test("managed Encounter writes only the actor and resolves sorted actor/partner account indices", async () => {
  const fixture = createEncounterHarness();
  const prepared = await prepareEncounterIntent(fixture.client, config, options);
  const context = [encounterFeePayer, "taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA", ...prepared.intent.readWriteAddresses!, ...prepared.intent.readOnlyAddresses!];
  const bytes = base64ToBytes(prepared.intent.instructionData), view = new DataView(bytes.buffer);
  assert.equal(context[view.getUint16(1, true)], encounterActor);
  assert.equal(context[view.getUint16(3, true)], encounterDonor);
  assert.ok(prepared.intent.readWriteAddresses!.includes(encounterActor));
  assert.ok(!prepared.intent.readWriteAddresses!.includes(encounterDonor));
  assert.ok(prepared.intent.readOnlyAddresses!.includes(encounterDonor));
  assert.equal(prepared.intent.review?.instruction, "encounter"); assert.equal(prepared.intent.stateUnits, 0);
  assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
});

test("Encounter submits canonical bytes once and verifies the real event, state and resource totals", async () => {
  const fixture = createEncounterHarness();
  const before = fixture.record(encounterDonor).data!.data.slice();
  const updates: EncounterTransactionUpdate[] = [];
  const reviewed = await prepareEncounterIntent(fixture.client, config, options);
  const result = await executeEncounterTransaction(fixture.client, config, fixture.wallet, { ...options, reviewed, onUpdate: update => updates.push(update) });
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
  assert.deepEqual(fixture.trace.submitted, fixture.trace.signed);
  assert.equal(result.stage, "confirmed"); assert.equal(result.organism?.state.encounterCount, 1n);
  assert.equal(result.event?.energyBefore, 2048n); assert.equal(result.event?.energyAfter, 2176n);
  assert.equal(result.event?.compatibility, 255); assert.equal(result.event?.geneTransferred, true);
  assert.equal(result.organism?.state.lastPulseSlot, 123n, "Encounter must not reset Pulse expiry");
  assert.deepEqual(fixture.record(encounterDonor).data!.data, before, "Partner remains read-only");
  assert.equal(result.metrics?.fee, 0n); assert.equal(result.metrics?.feePayer, encounterFeePayer);
  assert.equal(result.metrics?.computeUnits, 42_501_234); assert.equal(result.metrics?.stateUnits, 0);
  assert.deepEqual(updates.map(item => item.stage), ["preparing", "awaiting-approval", "signed", "submitting", "submitted", "syncing", "confirmed"]);
  assert.ok(matchesEncounterTransaction(Transaction.fromWire(fixture.trace.submitted!), result));
  assert.equal(identifyAccountTransaction(fixture.trace.transaction!, { walletAddress: encounterWallet, cambrianProgramId: config.programId, confirmed: true }).kind, "encounter");
  assert.equal(decodeEncounterEvent(fixture.trace.event!).encounterCount, 1n);
});

test("a copied genome bit can already match; a confirmed Encounter does not fabricate mutation", async () => {
  const fixture = createEncounterHarness({ donorBits: 0 });
  const result = await executeEncounterTransaction(fixture.client, config, fixture.wallet, options);
  assert.equal(result.event?.geneTransferred, true);
  assert.equal(bytesToHex(result.event!.genome), result.reviewedGenome);
});

for (const [label, harnessOptions] of [
  ["actor belongs to another wallet", { otherController: "actor" }], ["partner belongs to another wallet", { otherController: "donor" }],
  ["actor belongs to another program", { wrongOwner: "actor" }], ["partner belongs to another program", { wrongOwner: "donor" }],
  ["dead actor", { deadActor: true }], ["dead partner", { deadDonor: true }],
  ["invalid actor header", { wrongMagic: "actor" }], ["invalid partner header", { wrongMagic: "donor" }],
  ["unready node", { nodeReady: false }], ["saturated counter", { saturatedCounter: true }],
] as const) {
  test(`${label} is blocked before wallet approval`, async () => {
    const fixture = createEncounterHarness(harnessOptions);
    await assert.rejects(executeEncounterTransaction(fixture.client, config, fixture.wallet, options));
    assert.equal(fixture.trace.approvals, 0); assert.equal(fixture.trace.sends, 0);
  });
}

test("same-organism and invalid catalyst are rejected before an account read", async () => {
  const fixture = createEncounterHarness();
  await assert.rejects(prepareEncounterIntent(fixture.client, config, { ...options, donorAddress: encounterActor }), /different/);
  await assert.rejects(prepareEncounterIntent(fixture.client, config, { ...options, catalyst: -1n }), /catalyst/);
  assert.equal(fixture.trace.accountReads, 0);
});

test("review changes and approval-time changes in either organism stop broadcast", async () => {
  for (const role of ["changedActor", "changedDonor"] as const) {
    const harnessOptions: EncounterHarnessOptions = {};
    const fixture = createEncounterHarness(harnessOptions);
    const reviewed = await prepareEncounterIntent(fixture.client, config, options);
    harnessOptions[role] = true;
    await assert.rejects(executeEncounterTransaction(fixture.client, config, fixture.wallet, { ...options, reviewed }), /since review/);
    assert.equal(fixture.trace.approvals, 0);
    harnessOptions[role] = false; harnessOptions.afterApproval = () => { harnessOptions[role] = true; };
    await assert.rejects(executeEncounterTransaction(fixture.client, config, fixture.wallet, { ...options, reviewed }), /during approval/);
    assert.equal(fixture.trace.sends, 0);
  }
});

test("rejection, cancellation and a different signed instruction never submit Encounter", async () => {
  const rejected = createEncounterHarness({ reject: true });
  await assert.rejects(executeEncounterTransaction(rejected.client, config, rejected.wallet, options), /rejected/);
  assert.equal(rejected.trace.sends, 0);
  const controller = new AbortController();
  const cancelled = createEncounterHarness({ afterApproval: () => controller.abort() });
  await assert.rejects(executeEncounterTransaction(cancelled.client, config, cancelled.wallet, { ...options, signal: controller.signal }), /aborted/);
  assert.equal(cancelled.trace.sends, 0);
  const wrong = createEncounterHarness({ badSigned: true });
  await assert.rejects(executeEncounterTransaction(wrong.client, config, wrong.wallet, options), /does not match/);
  assert.equal(wrong.trace.sends, 0);
});

test("an uncertain stream or missing status keeps one receipt and never retries submission", async () => {
  for (const status of ["pending", "unavailable"] as const) {
    const harnessOptions: EncounterHarnessOptions = { stream: "disconnect", status };
    const fixture = createEncounterHarness(harnessOptions);
    const pending = await executeEncounterTransaction(fixture.client, config, fixture.wallet, options);
    assert.equal(pending.organism, undefined); assert.equal(pending.event, undefined);
    harnessOptions.status = undefined;
    const result = await confirmEncounterTransaction(fixture.client, config, pending, fast);
    assert.equal(result.event?.encounterCount, 1n);
    assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
  }
});

for (const [label, harnessOptions] of [
  ["stale account", { stale: true }], ["unreadable account", { unreadable: true }], ["wrong account owner", { wrongResultOwner: true }],
  ["wrong controller", { wrongResultController: true }], ["unrelated returned account", { wrongResultAddress: true }], ["missing event", { missingEvent: true }],
  ["event for another actor", { badEvent: "actor" }], ["event for another donor", { badEvent: "donor" }],
  ["event from another program", { badEvent: "program" }], ["impossible energy result", { badEvent: "energy" }], ["stale event count", { badEvent: "count" }],
] as const) {
  test(`confirmed execution with ${label} stays syncing, never green`, async () => {
    const fixture = createEncounterHarness(harnessOptions), updates: EncounterTransactionUpdate[] = [];
    const result = await executeEncounterTransaction(fixture.client, config, fixture.wallet, { ...options, onUpdate: update => updates.push(update) });
    assert.equal(result.stage, "confirmed"); assert.equal(result.organism, undefined);
    assert.equal(updates.at(-1)?.stage, "syncing"); assert.equal(updates.some(item => item.stage === "confirmed"), false);
  });
}

test("metadata-only receipts hydrate from canonical network bytes and later state is not attributed to the event", async () => {
  const fixture = createEncounterHarness({ metadataOnly: true, laterAction: true });
  const result = await executeEncounterTransaction(fixture.client, config, fixture.wallet, options);
  assert.equal(result.event?.energyAfter, 2176n);
  assert.equal(result.organism?.state.energy, 1000n);
  assert.equal(result.event?.encounterCount, 1n); assert.equal(result.organism?.state.encounterCount, 2n);
});

test("execution failure retains its signature and error and never reports success", async () => {
  for (const source of ["stream", "status", "full receipt"]) {
    const fixture = createEncounterHarness({ stream: source === "stream" ? "failed" : "accepted", status: source === "full receipt" ? undefined : "failed", fullFailed: source === "full receipt" });
    await assert.rejects(executeEncounterTransaction(fixture.client, config, fixture.wallet, options), error => error instanceof EncounterExecutionError
      && error.signature === fixture.trace.signature && error.vmError === -765);
    assert.equal(fixture.trace.sends, 1);
  }
});

test("public pending Encounter receipts survive refresh with wallet/program/RPC isolation", async () => {
  const fixture = createEncounterHarness();
  const result = await executeEncounterTransaction(fixture.client, config, fixture.wallet, options);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  savePendingEncounter(storage, config, encounterWallet, { ...result, intent: "do-not-store", raw: "do-not-store", passkey: "do-not-store" } as typeof result);
  const raw = [...values.values()][0];
  assert.doesNotMatch(raw, /intent|raw|passkey|signed|authenticator/);
  const loaded = loadPendingEncounter(storage, config, encounterWallet)!;
  assert.equal(loaded.catalyst, options.catalyst); assert.equal(loaded.organism, undefined); assert.equal(loaded.event, undefined);
  assert.equal(loadPendingEncounter(storage, config, encounterOtherWallet), null);
  assert.equal(loadPendingEncounter(storage, { ...config, rpcUrl: "https://other.invalid" }, encounterWallet), null);
  assert.ok((await confirmEncounterTransaction(fixture.client, config, loaded, fast)).event);
  assert.equal(fixture.trace.approvals, 1); assert.equal(fixture.trace.sends, 1);
  clearPendingEncounter(storage, config, encounterWallet); assert.equal(values.size, 0);
});

test("malformed Encounter events and receipts fail closed", () => {
  assert.throws(() => decodeEncounterEvent(new Uint8Array(156)));
  const event = new Uint8Array(157); event[0] = 2; event[67] = 1;
  new DataView(event.buffer).setUint16(65, 257, true);
  assert.throws(() => decodeEncounterEvent(event));
  const storage = { getItem: () => '{"stage":"confirmed","signature":"bad"}', setItem() {}, removeItem() {} };
  assert.equal(loadPendingEncounter(storage, config, encounterWallet), null);
});
