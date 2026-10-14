import { CAMBRIAN_ORGANISM_MAGIC, CAMBRIAN_ORGANISM_VERSION } from "./constants.js";

const BYTES32_LENGTH = 32;

export interface BirthInstructionInput {
  organismAccountIndex?: number;
  /** Explicitly authorized managed wallet. Omit only for the legacy wire format. */
  controllerAccountIndex?: number;
  seed: Uint8Array;
  entropy: Uint8Array;
  proof: Uint8Array;
}

export function encodeBirthInstruction({
  organismAccountIndex = 2,
  controllerAccountIndex,
  seed,
  entropy,
  proof,
}: BirthInstructionInput): Uint8Array {
  if (!Number.isInteger(organismAccountIndex) || organismAccountIndex < 0 || organismAccountIndex > 0xffff) {
    throw new Error("organismAccountIndex must fit in an unsigned 16-bit integer");
  }
  if (controllerAccountIndex !== undefined && (!Number.isInteger(controllerAccountIndex)
    || controllerAccountIndex < 2 || controllerAccountIndex > 0xffff || controllerAccountIndex === organismAccountIndex)) {
    throw new Error("controllerAccountIndex must reference a distinct managed wallet account");
  }
  assertBytes32(seed, "seed");
  assertBytes32(entropy, "entropy");
  if (proof.length > 0xffff_ffff) throw new Error("proof is too large");

  // Legacy birth (tag 0) is unchanged; wallet_birth (tag 5) adds a controller u16.
  const offset = controllerAccountIndex === undefined ? 0 : 2;
  const output = new Uint8Array(71 + offset + proof.length);
  const view = new DataView(output.buffer);
  output[0] = controllerAccountIndex === undefined ? 0 : 5;
  view.setUint16(1, organismAccountIndex, true);
  if (controllerAccountIndex !== undefined) view.setUint16(3, controllerAccountIndex, true);
  output.set(seed, 3 + offset);
  output.set(entropy, 35 + offset);
  view.setUint32(67 + offset, proof.length, true);
  output.set(proof, 71 + offset);
  return output;
}

export function utf8ToBytes32(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length === 0 || bytes.length > BYTES32_LENGTH) {
    throw new Error("seed must be between 1 and 32 UTF-8 bytes");
  }
  const padded = new Uint8Array(BYTES32_LENGTH);
  padded.set(bytes);
  return padded;
}

/** Tag 1, packed u16 organism index and u64 catalyst, both little-endian. */
export function encodePulseInstruction(organismAccountIndex: number, catalyst: bigint): Uint8Array {
  if (!Number.isInteger(organismAccountIndex) || organismAccountIndex < 2 || organismAccountIndex > 0xffff) {
    throw new Error("organismAccountIndex must reference a writable organism account");
  }
  if (typeof catalyst !== "bigint" || catalyst < 0n || catalyst > 0xffff_ffff_ffff_ffffn) {
    throw new Error("catalyst must fit in an unsigned 64-bit integer");
  }
  const bytes = new Uint8Array(11);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setUint16(1, organismAccountIndex, true);
  view.setBigUint64(3, catalyst, true);
  return bytes;
}

/** Tag 2 + two distinct u16 account indices + a u64 catalyst, packed little-endian. */
export function encodeEncounterInstruction(actorAccountIndex: number, donorAccountIndex: number, catalyst: bigint): Uint8Array {
  for (const index of [actorAccountIndex, donorAccountIndex]) {
    if (!Number.isInteger(index) || index < 2 || index > 0xffff) {
      throw new Error("Encounter indices must reference organism accounts");
    }
  }
  if (actorAccountIndex === donorAccountIndex) throw new Error("Choose two different organisms");
  if (typeof catalyst !== "bigint" || catalyst < 0n || catalyst > 0xffff_ffff_ffff_ffffn) {
    throw new Error("catalyst must fit in an unsigned 64-bit integer");
  }
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  bytes[0] = 2;
  view.setUint16(1, actorAccountIndex, true);
  view.setUint16(3, donorAccountIndex, true);
  view.setBigUint64(5, catalyst, true);
  return bytes;
}

export interface CambrianEncounterEvent {
  actor: Uint8Array;
  donor: Uint8Array;
  compatibility: number;
  outcome: 1 | 2 | 3;
  geneTransferred: boolean;
  energyBefore: bigint;
  energyAfter: bigint;
  encounterCount: bigint;
  genome: Uint8Array;
  memory: Uint8Array;
}

/** The C program emits tag 2 immediately before its packed 156-byte event. */
export function decodeEncounterEvent(bytes: Uint8Array): CambrianEncounterEvent {
  if (bytes.length !== 157 || bytes[0] !== 2) throw new Error("Invalid Encounter event layout");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compatibility = view.getUint16(65, true);
  const outcome = view.getUint8(67);
  const transferred = view.getUint8(68);
  if (compatibility > 256 || ![1, 2, 3].includes(outcome) || transferred > 1) {
    throw new Error("Invalid Encounter event values");
  }
  return {
    actor: bytes.slice(1, 33), donor: bytes.slice(33, 65), compatibility,
    outcome: outcome as 1 | 2 | 3, geneTransferred: transferred === 1,
    energyBefore: view.getBigUint64(69, true), energyAfter: view.getBigUint64(77, true),
    encounterCount: view.getBigUint64(85, true), genome: bytes.slice(93, 125), memory: bytes.slice(125, 157),
  };
}

export function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(BYTES32_LENGTH);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface CambrianOrganismState {
  magic: number;
  version: number;
  status: number;
  generation: number;
  controller: Uint8Array;
  parentA: Uint8Array;
  parentB: Uint8Array;
  genome: Uint8Array;
  lineage: Uint8Array;
  memory: Uint8Array;
  bornSlot: bigint;
  lastPulseSlot: bigint;
  age: bigint;
  energy: bigint;
  vitality: bigint;
  pulseCount: bigint;
  encounterCount: bigint;
  offspringCount: bigint;
}

/** Decode the 264-byte account layout produced by the Cambrian program. */
export function decodeCambrianOrganism(bytes: Uint8Array): CambrianOrganismState {
  if (bytes.length < 264) throw new Error(`organism account must be at least 264 bytes, got ${bytes.length}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint8(4);
  if (magic !== CAMBRIAN_ORGANISM_MAGIC) throw new Error("organism account has an invalid Cambrian magic header");
  if (version !== CAMBRIAN_ORGANISM_VERSION) throw new Error(`unsupported Cambrian organism version ${version}`);
  const copy = (offset: number, length: number) => bytes.slice(offset, offset + length);
  const u64 = (offset: number) => view.getBigUint64(offset, true);

  return {
    magic,
    version,
    status: view.getUint8(5),
    generation: view.getUint16(6, true),
    controller: copy(8, 32),
    parentA: copy(40, 32),
    parentB: copy(72, 32),
    genome: copy(104, 32),
    lineage: copy(136, 32),
    memory: copy(168, 32),
    bornSlot: u64(200),
    lastPulseSlot: u64(208),
    age: u64(216),
    energy: u64(224),
    vitality: u64(232),
    pulseCount: u64(240),
    encounterCount: u64(248),
    offspringCount: u64(256),
  };
}

function assertBytes32(value: Uint8Array, label: string): void {
  if (value.length !== BYTES32_LENGTH) throw new Error(`${label} must be exactly 32 bytes`);
}
