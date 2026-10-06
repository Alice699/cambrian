export type FeedbackTone = "success" | "pending" | "error";
export type BirthStage = "connecting" | "preparing" | "awaiting-approval" | "signed" | "submitting" | "submitted" | "syncing" | "confirmed" | "failed";

export function birthPresentation(stage: BirthStage, hasSignature = false) {
  const content: Record<BirthStage, [string, string, number]> = {
    connecting: ["Connect Thru Wallet", "Approve the connection in Thru Wallet. No transaction has been sent.", 0],
    preparing: ["Preparing your organism", "Checking its address and the wallet ownership before approval.", 0],
    "awaiting-approval": ["Confirm in Thru Wallet", "Review the Birth request in your wallet. Nothing is sent until you approve.", 0],
    signed: ["Wallet approval received", "Your approved transaction is ready to send to Thru Betanet.", 1],
    submitting: ["Sending your transaction", "Submitting exactly the transaction approved by your wallet.", 1],
    submitted: ["Waiting for confirmation", "The transaction is pending. Check its status instead of sending another Birth.", 2],
    syncing: ["Confirmed · syncing your organism", "The network confirmed Birth. Waiting for readable state and wallet ownership verification.", 3],
    confirmed: ["Your organism is ready", "Birth is confirmed and your organism's live state is available.", 4],
    failed: ["Birth was not completed", "Review the error below before trying again.", hasSignature ? 2 : 0],
  };
  const [title, description, step] = content[stage];
  const tone: FeedbackTone = stage === "confirmed" ? "success" : stage === "failed" ? "error" : "pending";
  const label = tone === "success" ? "Confirmed" : tone === "error" ? "Failed" : stage === "submitted" ? "Pending" : "In progress";
  return { title, description, step, tone, label };
}

export function noticeTone(notice: string): FeedbackTone {
  return notice.endsWith("-success") ? "success" : notice.endsWith("-error") ? "error" : "pending";
}

export function activeThruAddress(connected: boolean, address?: string | null): string | null {
  return connected && address ? address : null;
}
