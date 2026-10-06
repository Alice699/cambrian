import { createThruClient, type Thru } from "@thru/sdk/client";
import { StateProofType } from "@thru/sdk/proto";
import { buildWalletAccountContext } from "@thru/programs/passkey-manager";
import type { ThruTransactionIntent } from "@thru/wallet/react";
import { defaultCambrianConfig, type CambrianConfig } from "@cambrian/config";
import {
  bytesToBase64,
  encodeBirthInstruction,
  randomBytes32,
  utf8ToBytes32,
} from "./abi.js";
import { CAMBRIAN_BIRTH_STATE_UNITS, CAMBRIAN_INSTRUCTION_ABI_NAME } from "./constants.js";

export interface BirthIntentOptions {
  walletAddress: string;
  seed: string;
  entropy?: Uint8Array;
  /** Hosted wallet calls are wrapped by passkey-manager, unlike direct local signing. */
  signingMode?: "direct" | "thru-wallet";
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
  if (options.signingMode === "thru-wallet" && !config.walletBirthEnabled) {
    throw new Error("Wallet-owned Birth is awaiting the program upgrade. Nothing has been signed or submitted.");
  }
  const seed = utf8ToBytes32(options.seed);
  const entropy = options.entropy ?? randomBytes32();
  if (entropy.length !== 32) throw new Error("entropy must be exactly 32 bytes");

  const organismAddress = deriveOrganismAddress(client, config.programId, seed);
  const stateProof = await client.proofs.generate({
    address: organismAddress,
    proofType: StateProofType.CREATING,
  });
  const organismBytes = client.helpers.createPubkey(organismAddress).toBytes();
  // Only build instruction indices here. Thru Wallet still chooses the fee payer,
  // constructs the final transaction, and returns the canonical signed bytes.
  const walletContext = options.signingMode === "thru-wallet"
    ? buildWalletAccountContext({
      walletAddress: options.walletAddress,
      readWriteAccounts: [organismBytes],
      readOnlyAccounts: [client.helpers.createPubkey(config.programId).toBytes()],
    })
    : null;
  const instructionData = encodeBirthInstruction({
    organismAccountIndex: walletContext?.getAccountIndex(organismBytes) ?? 2,
    ...(walletContext ? { controllerAccountIndex: walletContext.walletAccountIdx } : {}),
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
      stateUnits: CAMBRIAN_BIRTH_STATE_UNITS,
      readWriteAddresses: walletContext?.readWriteAddresses ?? [organismAddress],
      ...(walletContext ? { readOnlyAddresses: walletContext.readOnlyAddresses } : {}),
      review: {
        appName: "Cambrian",
        programAddress: config.programId,
        abiName: CAMBRIAN_INSTRUCTION_ABI_NAME,
        instruction: walletContext ? "wallet_birth" : "birth",
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
