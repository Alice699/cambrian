import { Pubkey, type Transaction } from "@thru/sdk";
import { buildMulticallInstruction, MULTICALL_PROGRAM_ADDRESS } from "@thru/programs/multicall";
import { encodeLegacyCreateInstruction, encodeRegisterCredentialInstruction, encodeValidateInstruction,
  PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import { encodeBirthInstruction } from "../../packages/cambrian-sdk/src/abi.ts";
import { defaultCambrianConfig } from "../../packages/config/src/index.ts";
import { confirmedWalletBirthAccount } from "./confirmed-wallet-birth-account.ts";

// Public identifiers from the verified account-creation receipt at slot 622275.
// All instruction/proof/authentication bytes below are synthetic offline test data.
// These mocks are NOT signed transactions and must never be submitted on-chain.
export const walletBAddress = "ta8C-pk5U5HUwE_e2dnRhiww3UYZ0wj0daXiGaKbn4OnXY";
export const walletBSetupSignature = "tsjq2DtPk04Vanlm-aOM0aca90O1TJaTOd7srbLuXt1wzFkBzma6l78c7pomDnlUWpp8U19vP7QAovLVSq-zqhDiPd";
const lookupAddress = "taCg6lwQz3zkSo7jbiYRGSEpNeLQzIEiXl4_gPykCDaxNa";
const proof = new Uint8Array(104); // ABI-shaped fixture only, not a valid Merkle proof.

export function makeWalletSetupTransaction(walletAddress = walletBAddress, vmError: number | undefined = 0): Transaction {
  const create = encodeLegacyCreateInstruction({ walletAccountIdx: 3,
    authorityRecord: { authority: { tag: 2, pubkey: new Uint8Array(32).fill(0x11) }, expiresAtBlockTimeSeconds: 0n },
    seed: new Uint8Array(32).fill(0x22), stateProof: proof });
  const register = encodeRegisterCredentialInstruction({ walletAccountIdx: 3, lookupAccountIdx: 2,
    seed: new Uint8Array(32).fill(0x33), stateProof: proof });
  return {
    feePayer: Pubkey.from("taScxRpNhfgieN2xpqETwEYH_ZXT07hy9z3AxEWzZatUjx"),
    program: Pubkey.from(MULTICALL_PROGRAM_ADDRESS),
    readWriteAccounts: [Pubkey.from(lookupAddress), Pubkey.from(walletAddress)],
    readOnlyAccounts: [Pubkey.from(PASSKEY_MANAGER_PROGRAM_ADDRESS)],
    instructionData: buildMulticallInstruction([{ programIdx: 4, instructionData: create }, { programIdx: 4, instructionData: register }]),
    slot: 622275n,
    executionResult: vmError === undefined ? undefined : { vmError, userErrorCode: 0n },
    getSignature: () => ({ toThruFmt: () => walletBSetupSignature }),
  } as unknown as Transaction;
}

export function makeWalletBirthTransaction(walletAddress = confirmedWalletBirthAccount.controller, vmError: number | undefined = 0): Transaction {
  return {
    feePayer: Pubkey.from(confirmedWalletBirthAccount.feePayer),
    program: Pubkey.from(PASSKEY_MANAGER_PROGRAM_ADDRESS),
    readWriteAccounts: [Pubkey.from(walletAddress), Pubkey.from(confirmedWalletBirthAccount.address)],
    readOnlyAccounts: [Pubkey.from(defaultCambrianConfig.programId)],
    instructionData: encodeValidateInstruction({ walletAccountIdx: 2, authIdx: 0,
      targetInstruction: { programIdx: 4, instructionData: encodeBirthInstruction({ organismAccountIndex: 3, controllerAccountIndex: 2,
        seed: new Uint8Array(32).fill(0x44), entropy: new Uint8Array(32).fill(0x55), proof }) },
      signatureR: new Uint8Array(32).fill(1), signatureS: new Uint8Array(32).fill(2),
      authenticatorData: new Uint8Array(37), clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get","origin":"https://test.invalid"}') }),
    slot: 622115n,
    executionResult: vmError === undefined ? undefined : { vmError, userErrorCode: 0n },
    getSignature: () => ({ toThruFmt: () => confirmedWalletBirthAccount.signature }),
  } as unknown as Transaction;
}
