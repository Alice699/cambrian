import { apiBaseUrl } from "./config";

export type FaucetApiStatus = "submitted" | "confirmed";

export interface FaucetApiReceipt {
  status: FaucetApiStatus;
  requestId: string;
  address: string;
  amount: string;
  signature?: string;
}

export class FaucetApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: { status: number; code?: string; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "FaucetApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function createIdempotencyKey() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? "cambrian-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

export async function claimFaucet(address: string, signal?: AbortSignal): Promise<FaucetApiReceipt> {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  let response: Response;

  try {
    response = await fetch(baseUrl + "/faucet/claim", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": createIdempotencyKey(),
      },
      body: JSON.stringify({ address }),
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new FaucetApiError(
      "Faucet API tidak dapat dijangkau. Pastikan service API sedang berjalan.",
      { status: 0, code: "network-error" },
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload && typeof payload === "object"
      ? payload as { message?: unknown; error?: unknown; retryAfterSeconds?: unknown }
      : {};
    throw new FaucetApiError(
      typeof body.message === "string" ? body.message : "Faucet request gagal.",
      {
        status: response.status,
        code: typeof body.error === "string" ? body.error : undefined,
        retryAfterSeconds: typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined,
      },
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new FaucetApiError("Faucet API mengembalikan response yang tidak valid.", {
      status: response.status,
      code: "invalid-response",
    });
  }

  const receipt = payload as Partial<FaucetApiReceipt>;
  if (
    (receipt.status !== "submitted" && receipt.status !== "confirmed") ||
    typeof receipt.requestId !== "string" ||
    typeof receipt.address !== "string" ||
    typeof receipt.amount !== "string"
  ) {
    throw new FaucetApiError("Faucet API mengembalikan receipt yang tidak lengkap.", {
      status: response.status,
      code: "invalid-response",
    });
  }

  return receipt as FaucetApiReceipt;
}
