import { execFile } from "node:child_process";

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

const THRU_ADDRESS_PATTERN = /^ta[A-Za-z0-9_-]{20,128}$/;
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

interface CliFaucetProviderOptions {
  command: string;
  rpcUrl: string;
  feePayer: string;
  timeoutMs?: number;
}

interface CliExecutionResult {
  error: unknown;
  stdout: string;
  stderr: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findStringField(
  value: unknown,
  keys: readonly string[],
  depth = 0,
): string | undefined {
  if (depth > 4 || !isRecord(value)) return undefined;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  for (const child of Object.values(value)) {
    const result = findStringField(child, keys, depth + 1);
    if (result) return result;
  }

  return undefined;
}

function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return undefined;
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
}

function providerErrorMessage(body: unknown, fallback: string): string {
  const message = findStringField(body, ["message", "detail", "reason", "error"]);
  const normalized = (message ?? fallback).replace(/\s+/g, " ").trim();
  return normalized.slice(0, 240) || "The Thru faucet CLI could not process the claim.";
}

function executionErrorMessage(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const message = error.message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function extractCliPayout(body: unknown): FaucetPayout {
  if (isRecord(body) && body.error !== undefined) {
    throw new FaucetError(
      "provider-error",
      providerErrorMessage(body.error, "The Thru faucet CLI returned an error."),
      503,
    );
  }

  const rawStatus = findStringField(body, ["status", "state"])?.toLowerCase();
  const status: FaucetPayoutStatus =
    rawStatus === "confirmed" || rawStatus === "finalized"
      ? "confirmed"
      : "submitted";
  const signature = findStringField(body, [
    "signature",
    "txSignature",
    "transactionSignature",
    "txHash",
    "transactionHash",
  ]);

  return {
    status,
    ...(signature ? { signature } : {}),
  };
}

function execFileAsync(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CliExecutionResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        shell: process.platform === "win32",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          error,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });
}

function validateCliRpcUrl(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new Error("FAUCET_CLI_RPC_URL must use HTTPS outside local development");
  }
  return value;
}

const CLI_ACCOUNT_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class CliFaucetProvider implements FaucetPayoutProvider {
  readonly configured = true;
  private readonly command: string;
  private readonly rpcUrl: string;
  private readonly feePayer: string;
  private readonly timeoutMs: number;

  constructor(options: CliFaucetProviderOptions) {
    if (!options.command.trim()) throw new Error("FAUCET_CLI_PATH must not be empty");
    if (!CLI_ACCOUNT_PATTERN.test(options.feePayer)) {
      throw new Error("FAUCET_CLI_FEE_PAYER contains unsupported characters");
    }

    this.command = options.command.trim();
    this.rpcUrl = validateCliRpcUrl(options.rpcUrl.trim());
    this.feePayer = options.feePayer;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async requestPayout(request: FaucetPayoutRequest): Promise<FaucetPayout> {
    const args = [
      "--json",
      "--quiet",
      "faucet",
      "withdraw",
      request.address,
      request.amount.toString(),
      "--fee-payer",
      this.feePayer,
      "--url",
      this.rpcUrl,
    ];
    let result: CliExecutionResult;
    try {
      result = await execFileAsync(this.command, args, this.timeoutMs);
    } catch (error) {
      throw new FaucetError(
        "provider-error",
        providerErrorMessage(error, "The Thru faucet CLI could not be started."),
        503,
      );
    }
    const body = parseCliJson(result.stdout);

    if (result.error) {
      const fallback =
        result.stderr ||
        executionErrorMessage(result.error) ||
        "The Thru faucet CLI could not process the claim.";
      throw new FaucetError("provider-error", providerErrorMessage(body, fallback), 503);
    }

    return extractCliPayout(body);
  }
}

export function createFaucetProviderFromEnv(
  env: Record<string, string | undefined>,
): FaucetPayoutProvider {
  const cliEnabled = env.FAUCET_CLI_ENABLED?.trim().toLowerCase() === "true";
  if (cliEnabled) {
    return new CliFaucetProvider({
      command: env.FAUCET_CLI_PATH?.trim() || (process.platform === "win32" ? "thru.cmd" : "thru"),
      rpcUrl: validateCliRpcUrl(env.FAUCET_CLI_RPC_URL?.trim() || "https://rpc.betanet.thru.org"),
      feePayer: env.FAUCET_CLI_FEE_PAYER?.trim() || "default",
      timeoutMs: parseDuration(
        env,
        "FAUCET_CLI_TIMEOUT_MS",
        parseDuration(env, "FAUCET_PROVIDER_TIMEOUT_MS", 15_000),
      ),
    });
  }

  const url = env.FAUCET_PROVIDER_URL?.trim();
  if (!url) return new UnavailableFaucetProvider();
  return new HttpFaucetProvider({
    url,
    token: env.FAUCET_PROVIDER_TOKEN,
    timeoutMs: parseDuration(env, "FAUCET_PROVIDER_TIMEOUT_MS", 10_000),
  });
}
