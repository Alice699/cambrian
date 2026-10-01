import type { CambrianConfig } from "@cambrian/config";

export function assertBirthDeployment(config: CambrianConfig): void {
  if (!config.programId) throw new Error("Cambrian program ID is not configured yet");
  if (!config.abiId) throw new Error("Cambrian ABI ID is not configured yet");
}
