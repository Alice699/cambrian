import { Pubkey } from "@thru/sdk";

/**
 * Native THRU amounts are uint64 values on-chain. Keep the value as a bigint
 * all the way to the transaction builder so a browser Number cannot round it.
 */
export interface NativeTransferReview {
  recipient: string;
  amount: bigint;
  amountText: string;
}

export interface PrepareNativeTransferReviewOptions {
  recipient: string;
  amount: string;
  balance?: bigint | null;
}

/**
 * Validate the user-facing fields before a native transfer can be reviewed.
 *
 * This deliberately prepares review data only. The installed Thru web SDK
 * does not currently expose the official native-transfer instruction builder,
 * so no unsigned bytes are fabricated here.
 */
export function prepareNativeTransferReview({
  recipient,
  amount,
  balance,
}: PrepareNativeTransferReviewOptions): NativeTransferReview {
  const normalizedRecipient = recipient.trim();
  if (!normalizedRecipient) throw new Error("Enter a recipient address first");

  let canonicalRecipient: string;
  try {
    canonicalRecipient = Pubkey.from(normalizedRecipient).toThruFmt();
  } catch {
    throw new Error("Enter a valid Thru address");
  }

  const amountText = amount.trim();
  if (!/^\d+$/.test(amountText)) {
    throw new Error("Amount must be a whole number of native THRU units");
  }

  let parsedAmount: bigint;
  try {
    parsedAmount = BigInt(amountText);
  } catch {
    throw new Error("Amount is too large");
  }

  if (parsedAmount <= 0n) throw new Error("Enter an amount greater than zero");
  if (parsedAmount > 0xffff_ffff_ffff_ffffn) throw new Error("Amount is too large");
  if (balance !== undefined && balance !== null && parsedAmount > balance) {
    throw new Error("Amount exceeds the available balance");
  }

  return {
    recipient: canonicalRecipient,
    amount: parsedAmount,
    amountText: parsedAmount.toString(),
  };
}
