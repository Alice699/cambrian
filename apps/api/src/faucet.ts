export type FaucetPayoutStatus = "submitted" | "confirmed";

export interface FaucetPolicy {
  amount: bigint;
  cooldownMs: number;
  windowMs: number;
  maxRequestsPerWindow: number;
}

export interface FaucetPayoutRequest {
  address: string;
  amount: bigint;
  requestId: string;
}

export interface FaucetPayout {
  status: FaucetPayoutStatus;
  signature?: string;
}

export interface FaucetClaimReceipt {
  status: FaucetPayoutStatus;
  requestId: string;
  address: string;
  amount: string;
  signature?: string;
}

export interface FaucetPayoutProvider {
  readonly configured: boolean;
  requestPayout(request: FaucetPayoutRequest): Promise<FaucetPayout>;
}

export type FaucetErrorCode =
  | "invalid-address"
  | "invalid-idempotency-key"
  | "idempotency-conflict"
  | "rate-limited"
  | "cooldown"
  | "in-progress"
  | "not-configured"
  | "provider-error";

export class FaucetError extends Error {
  readonly code: FaucetErrorCode;
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: FaucetErrorCode,
    message: string,
    statusCode: number,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "FaucetError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const THRU_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{20,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function normalizeThruAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new FaucetError("invalid-address", "A Thru address is required.", 400);
  }

  const address = value.trim();
  if (!THRU_ADDRESS_PATTERN.test(address)) {
    throw new FaucetError("invalid-address", "The Thru address format is invalid.", 400);
  }

  return address;
}

export function normalizeIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new FaucetError(
      "invalid-idempotency-key",
      "The idempotency key must be 8-128 safe characters.",
      400,
    );
  }
  return value;
}

function parseDuration(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(key + " must be a non-negative number");
  }
  return Math.floor(value);
}

function parsePositiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const value = parseDuration(env, key, fallback);
  if (value < 1) throw new Error(key + " must be greater than zero");
  return value;
}

export function createFaucetPolicyFromEnv(
  env: Record<string, string | undefined>,
): FaucetPolicy {
  let amount = 0n;
  const rawAmount = env.FAUCET_AMOUNT_UNITS?.trim();
  if (rawAmount) {
    try {
      amount = BigInt(rawAmount);
    } catch {
      throw new Error("FAUCET_AMOUNT_UNITS must be an integer");
    }
    if (amount < 1n) throw new Error("FAUCET_AMOUNT_UNITS must be greater than zero");
  }

  return {
    amount,
    cooldownMs: parseDuration(env, "FAUCET_COOLDOWN_MS", 24 * 60 * 60 * 1000),
    windowMs: parsePositiveInteger(env, "FAUCET_RATE_WINDOW_MS", 60 * 60 * 1000),
    maxRequestsPerWindow: parsePositiveInteger(env, "FAUCET_RATE_MAX", 3),
  };
}

interface IdempotencyRecord {
  address: string;
  pending?: Promise<FaucetClaimReceipt>;
  result?: FaucetClaimReceipt;
}

export interface FaucetClaimInput {
  address: unknown;
  ip: string;
  idempotencyKey?: unknown;
}

export interface FaucetAuditEvent {
  type: "claim.accepted" | "claim.completed" | "claim.failed";
  at: number;
  address: string;
  requestId: string;
  ip: string;
  status?: FaucetPayoutStatus;
  reason?: string;
}

export interface FaucetServiceOptions {
  policy: FaucetPolicy;
  provider: FaucetPayoutProvider;
  now?: () => number;
  createRequestId?: () => string;
  onAudit?: (event: FaucetAuditEvent) => void;
}

export class FaucetService {
  private readonly policy: FaucetPolicy;
  private readonly provider: FaucetPayoutProvider;
  private readonly now: () => number;
  private readonly createRequestId: () => string;
  private readonly onAudit: (event: FaucetAuditEvent) => void;
  private readonly lastClaimAt = new Map<string, number>();
  private readonly activeClaims = new Map<string, Promise<FaucetClaimReceipt>>();
  private readonly attemptsByIp = new Map<string, number[]>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor(options: FaucetServiceOptions) {
    if (options.policy.amount < 0n) throw new Error("Faucet amount cannot be negative");
    if (options.policy.windowMs < 1) throw new Error("Faucet rate window must be positive");
    if (options.policy.maxRequestsPerWindow < 1) throw new Error("Faucet rate max must be positive");

    this.policy = options.policy;
    this.provider = options.provider;
    this.now = options.now ?? (() => Date.now());
    this.onAudit = options.onAudit ?? (() => {});
    this.createRequestId = options.createRequestId ?? (() => {
      const randomId = globalThis.crypto?.randomUUID?.();
      return randomId ?? "faucet-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    });
  }

  getStatus() {
    return {
      configured: this.policy.amount > 0n && this.provider.configured,
      amount: this.policy.amount > 0n ? this.policy.amount.toString() : null,
    };
  }

  async claim(input: FaucetClaimInput): Promise<FaucetClaimReceipt> {
    const address = normalizeThruAddress(input.address);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const existing = idempotencyKey ? this.idempotency.get(idempotencyKey) : undefined;

    if (existing) {
      if (existing.address !== address) {
        throw new FaucetError(
          "idempotency-conflict",
          "This idempotency key belongs to another address.",
          409,
        );
      }
      if (existing.result) return existing.result;
      if (existing.pending) return existing.pending;
    }

    if (!this.getStatus().configured) {
      throw new FaucetError(
        "not-configured",
        "The Betanet faucet provider is not configured yet.",
        503,
      );
    }

    const active = this.activeClaims.get(address);
    if (active) {
      throw new FaucetError(
        "in-progress",
        "A faucet claim for this address is already in progress.",
        409,
      );
    }

    const now = this.now();
    const lastClaimAt = this.lastClaimAt.get(address);
    if (lastClaimAt !== undefined) {
      const elapsed = now - lastClaimAt;
      if (elapsed < this.policy.cooldownMs) {
        const retryAfterSeconds = Math.ceil((this.policy.cooldownMs - elapsed) / 1000);
        throw new FaucetError(
          "cooldown",
          "This address is still within the faucet cooldown.",
          429,
          retryAfterSeconds,
        );
      }
    }

    this.consumeRateLimit(input.ip || "unknown", now);

    const requestId = this.createRequestId();
    this.audit({
      type: "claim.accepted",
      at: now,
      address,
      requestId,
      ip: input.ip || "unknown",
    });
    const pending = this.provider
      .requestPayout({ address, amount: this.policy.amount, requestId })
      .then((payout) => {
        if (payout.status !== "submitted" && payout.status !== "confirmed") {
          throw new FaucetError("provider-error", "The faucet provider returned an invalid status.", 503);
        }

        const receipt: FaucetClaimReceipt = {
          status: payout.status,
          requestId,
          address,
          amount: this.policy.amount.toString(),
          ...(payout.signature ? { signature: payout.signature } : {}),
        };
        const completedAt = this.now();
        this.lastClaimAt.set(address, completedAt);
        this.audit({
          type: "claim.completed",
          at: completedAt,
          address,
          requestId,
          ip: input.ip || "unknown",
          status: payout.status,
        });
        return receipt;
      })
      .catch((error) => {
        this.audit({
          type: "claim.failed",
          at: this.now(),
          address,
          requestId,
          ip: input.ip || "unknown",
          reason: error instanceof FaucetError ? error.code : "provider-error",
        });
        if (error instanceof FaucetError) throw error;
        throw new FaucetError("provider-error", "The faucet provider could not process the claim.", 503);
      });

    this.activeClaims.set(address, pending);
    const record: IdempotencyRecord | undefined = idempotencyKey ? { address } : undefined;
    if (idempotencyKey && record) {
      record.pending = pending;
      this.idempotency.set(idempotencyKey, record);
    }

    try {
      const result = await pending;
      if (idempotencyKey && record) {
        record.pending = undefined;
        record.result = result;
      }
      return result;
    } catch (error) {
      if (idempotencyKey && this.idempotency.get(idempotencyKey) === record) {
        this.idempotency.delete(idempotencyKey);
      }
      throw error;
    } finally {
      if (this.activeClaims.get(address) === pending) this.activeClaims.delete(address);
    }
  }

  private audit(event: FaucetAuditEvent) {
    try {
      this.onAudit(event);
    } catch {
      // Observability must never change the payout result.
    }
  }

  private consumeRateLimit(ip: string, now: number) {
    const attempts = this.attemptsByIp.get(ip) ?? [];
    const recentAttempts = attempts.filter((timestamp) => now - timestamp < this.policy.windowMs);
    if (recentAttempts.length >= this.policy.maxRequestsPerWindow) {
      const retryAfterSeconds = Math.ceil(
        (this.policy.windowMs - (now - recentAttempts[0])) / 1000,
      );
      throw new FaucetError(
        "rate-limited",
        "Too many faucet requests from this network.",
        429,
        Math.max(1, retryAfterSeconds),
      );
    }
    recentAttempts.push(now);
    this.attemptsByIp.set(ip, recentAttempts);
  }
}

export class UnavailableFaucetProvider implements FaucetPayoutProvider {
  readonly configured = false;

  async requestPayout(): Promise<FaucetPayout> {
    throw new FaucetError("not-configured", "The faucet provider is not configured yet.", 503);
  }
}

interface HttpFaucetProviderOptions {
  url: string;
  token?: string;
  timeoutMs?: number;
}

export class HttpFaucetProvider implements FaucetPayoutProvider {
  readonly configured = true;
  private readonly url: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(options: HttpFaucetProviderOptions) {
    const parsed = new URL(options.url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("FAUCET_PROVIDER_URL must use HTTPS outside local development");
    }
    this.url = options.url;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async requestPayout(request: FaucetPayoutRequest): Promise<FaucetPayout> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/json",
      };
      if (this.token) headers.authorization = "Bearer " + this.token;

      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          network: "betanet",
          address: request.address,
          amount: request.amount.toString(),
          requestId: request.requestId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("upstream status " + response.status);

      const body: unknown = await response.json();
      if (!body || typeof body !== "object") throw new Error("invalid upstream response");
      const status = (body as { status?: unknown }).status;
      if (status !== "submitted" && status !== "confirmed") {
        throw new Error("invalid upstream payout status");
      }
      const signature = (body as { signature?: unknown }).signature;
      return {
        status,
        ...(typeof signature === "string" ? { signature } : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createFaucetProviderFromEnv(
  env: Record<string, string | undefined>,
): FaucetPayoutProvider {
  const url = env.FAUCET_PROVIDER_URL?.trim();
  if (!url) return new UnavailableFaucetProvider();
  return new HttpFaucetProvider({
    url,
    token: env.FAUCET_PROVIDER_TOKEN,
    timeoutMs: parseDuration(env, "FAUCET_PROVIDER_TIMEOUT_MS", 10_000),
  });
}
