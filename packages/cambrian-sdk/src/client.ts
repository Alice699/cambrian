import { createThruClient, type Thru } from "@thru/sdk/client";
import { StateProofType } from "@thru/sdk/proto";
import type { ThruTransactionIntent } from "@thru/wallet/react";
import { defaultCambrianConfig, type CambrianConfig } from "@cambrian/config";
import {
  bytesToBase64,
  encodeBirthInstruction,
  randomBytes32,
  utf8ToBytes32,
} from "./abi.js";

export interface BirthIntentOptions {
  walletAddress: string;
  seed: string;
  entropy?: Uint8Array;
}

export interface PreparedBirthIntent {
  intent: ThruTransactionIntent;
  organismAddress: string;
  seed: Uint8Array;
  entropy: Uint8Array;
  proof: Uint8Array;
}

export function createCambrianClient(config: CambrianConfig = defaultCambrianConfig): Thru {
  return createThruClient({ baseUrl: config.rpcUrl });
}

export function deriveOrganismAddress(client: Thru, programId: string, seed: Uint8Array): string {
  if (!programId) throw new Error("Cambrian program ID is not configured yet");
  return client.helpers.deriveProgramAddress({ programAddress: programId, seed }).address;
}

export async function prepareBirthIntent(
  client: Thru,
  config: CambrianConfig,
  options: BirthIntentOptions,
): Promise<PreparedBirthIntent> {
  if (!config.programId) throw new Error("Cambrian program ID is not configured yet");
  const seed = utf8ToBytes32(options.seed);
  const entropy = options.entropy ?? randomBytes32();
  if (entropy.length !== 32) throw new Error("entropy must be exactly 32 bytes");

  const organismAddress = deriveOrganismAddress(client, config.programId, seed);
  const stateProof = await client.proofs.generate({
    address: organismAddress,
    proofType: StateProofType.CREATING,
  });
  const instructionData = encodeBirthInstruction({
    organismAccountIndex: 2,
    seed,
    entropy,
    proof: stateProof.proof,
  });

  return {
    organismAddress,
    seed,
    entropy,
    proof: stateProof.proof,
    intent: {
      walletAddress: options.walletAddress,
      programAddress: config.programId,
      instructionData: bytesToBase64(instructionData),
      readWriteAddresses: [organismAddress],
      review: {
        appName: "Cambrian",
        programAddress: config.programId,
        abiName: config.abiId || "CambrianInstruction",
        instruction: "birth",
      },
    },
  };
}

export async function readAccount(client: Thru, address: string) {
  return client.accounts.get(address);
}

export async function readNodeStatus(client: Thru) {
  return client.node.getStatus();
}
