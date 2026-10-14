import type { CambrianConfig } from "@cambrian/config";
import { bytesToHex } from "./abi.js";
import { CAMBRIAN_ORGANISM_MAGIC, CAMBRIAN_ORGANISM_VERSION } from "./constants.js";
import { isOrganismControlledBy, type CambrianOrganismRecord } from "./read-service.js";

export type EncounterOutcome = "symbiosis" | "adaptation" | "stress";
export interface EncounterPreview {
  compatibility: number;
  outcome: EncounterOutcome;
  energyBefore: bigint;
  energyAfter: bigint;
  energyDelta: bigint;
  statusAfter: 1 | 2 | 3;
  geneCopyPossible: boolean;
}
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
export const ENCOUNTER_MAX_ENERGY = 65535n;

/** Exactly the C program's 256-bit Hamming comparison, not a visual similarity score. */
export function genomeCompatibility(actor: Uint8Array, donor: Uint8Array): number {
  if (actor.length !== 32 || donor.length !== 32) throw new Error("Encounter genomes must be exactly 32 bytes");
  let different = 0;
  for (let i = 0; i < 32; i++) {
    let bits = actor[i] ^ donor[i];
    while (bits) { bits &= bits - 1; different++; }
  }
  return 256 - different;
}

export function encounterPreview(actor: CambrianOrganismRecord, donor: CambrianOrganismRecord): EncounterPreview {
  const compatibility = genomeCompatibility(actor.state.genome, donor.state.genome);
  const outcome: EncounterOutcome = compatibility >= 192 ? "symbiosis" : compatibility >= 96 ? "adaptation" : "stress";
  const delta = outcome === "symbiosis" ? 128n : outcome === "adaptation" ? 32n : -96n;
  const changed = actor.state.energy + delta;
  const energyAfter = changed < 0n ? 0n : changed > ENCOUNTER_MAX_ENERGY ? ENCOUNTER_MAX_ENERGY : changed;
  return {
    compatibility, outcome, energyBefore: actor.state.energy, energyAfter,
    energyDelta: energyAfter - actor.state.energy,
    statusAfter: actor.state.vitality === 0n ? 3 : energyAfter < 256n ? 2 : 1,
    geneCopyPossible: outcome !== "stress",
  };
}

/** Same-wallet policy is a dapp restriction; the existing C program only authorizes the actor. */
export function encounterEligibility(actor: CambrianOrganismRecord, donor: CambrianOrganismRecord,
  config: CambrianConfig, walletAddress: string): { allowed: boolean; reason: string; preview?: EncounterPreview } {
  const deny = (reason: string) => ({ allowed: false, reason });
  if (actor.address === donor.address) return deny("Choose two different organisms.");
  for (const [role, organism] of [["Selected", actor], ["Partner", donor]] as const) {
    if (organism.owner !== config.programId) return deny(`${role} organism is not owned by the Cambrian program.`);
    if (organism.state.magic !== CAMBRIAN_ORGANISM_MAGIC || organism.state.version !== CAMBRIAN_ORGANISM_VERSION) {
      return deny(`${role} organism has an unsupported account layout.`);
    }
    try {
      if (!isOrganismControlledBy(organism, walletAddress)) return deny("Both organisms must be controlled by the connected wallet.");
    } catch { return deny("The wallet or organism address is invalid."); }
    if (organism.state.status === 3) return deny(`${role} organism is dead and cannot Encounter.`);
    if (![1, 2].includes(organism.state.status)) return deny(`${role} organism has an unsupported status.`);
    if (organism.state.energy < 0n || organism.state.energy > ENCOUNTER_MAX_ENERGY
      || organism.state.vitality < 0n || organism.state.vitality > 1024n) return deny(`${role} organism has invalid traits.`);
  }
  if (actor.state.encounterCount >= MAX_U64) return deny("The Encounter counter has reached its limit.");
  try {
    return { allowed: true, reason: "Only the selected organism changes. Its partner is read-only.", preview: encounterPreview(actor, donor) };
  } catch (error) { return deny(error instanceof Error ? error.message : "The genomes could not be verified."); }
}

/** All 264 public state bytes are compared again before approval and submission. */
export function encounterStateFingerprint(organism: CambrianOrganismRecord): string {
  if (!organism.data || organism.data.length < 264) throw new Error("Encounter requires a complete organism state read.");
  return `${organism.address}:${organism.owner}:${bytesToHex(organism.data.slice(0, 264))}`;
}
