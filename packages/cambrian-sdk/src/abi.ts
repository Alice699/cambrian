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
