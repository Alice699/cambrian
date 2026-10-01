import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  FaucetError,
  FaucetService,
  createFaucetPolicyFromEnv,
  createFaucetProviderFromEnv,
} from "./faucet.ts";

const MAX_BODY_BYTES = 8 * 1024;

interface ApiServerOptions {
  service?: FaucetService;
  allowedOrigin?: string;
  trustProxy?: boolean;
}

class RequestInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "RequestInputError";
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  response.end(JSON.stringify(payload));
}

function applyCors(request: IncomingMessage, response: ServerResponse, allowedOrigin: string) {
  const requestOrigin = request.headers.origin;
  if (allowedOrigin === "*") {
    response.setHeader("access-control-allow-origin", "*");
  } else if (typeof requestOrigin === "string" && requestOrigin === allowedOrigin) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-headers", "content-type, idempotency-key");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

function readRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: unknown[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: { length?: number }) => {
      totalBytes += chunk.length ?? 0;
      if (totalBytes > MAX_BODY_BYTES) {
        request.resume?.();
        reject(new RequestInputError("Request body is too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", (error: Error) => reject(error));
    request.on("end", () => {
      if (totalBytes === 0) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new RequestInputError("Request body must be valid JSON."));
      }
    });
  });
}

function getClientIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress ?? "unknown";
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function parseClaimInput(body: unknown, request: IncomingMessage, trustProxy: boolean) {
  if (!body || typeof body !== "object") {
    throw new RequestInputError("Request body must be an object.");
  }

  const payload = body as { address?: unknown; idempotencyKey?: unknown };
  const headerKey = getHeader(request, "idempotency-key");
  return {
    address: payload.address,
    idempotencyKey: headerKey ?? payload.idempotencyKey,
    ip: getClientIp(request, trustProxy),
  };
}

function defaultService(): FaucetService {
  const env = process.env;
  return new FaucetService({
    policy: createFaucetPolicyFromEnv(env),
    provider: createFaucetProviderFromEnv(env),
    onAudit: (event) => console.log("[Cambrian API] faucet " + JSON.stringify(event)),
  });
}

export function createApiServer(options: ApiServerOptions = {}) {
  const service = options.service ?? defaultService();
  const allowedOrigin = options.allowedOrigin ?? process.env.CORS_ORIGIN ?? "*";
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "true";

  return createServer(async (request, response) => {
    applyCors(request, response, allowedOrigin);

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const path = (request.url ?? "/").split("?")[0];
    if (request.method === "GET" && path === "/health") {
      writeJson(response, 200, {
        ok: true,
        network: "betanet",
        faucet: service.getStatus(),
      });
      return;
    }

    if (request.method !== "POST" || (path !== "/api/faucet/claim" && path !== "/faucet/claim")) {
      writeJson(response, 404, { error: "not-found", message: "Route not found." });
      return;
    }

    try {
      const body = await readRequestBody(request);
      const receipt = await service.claim(parseClaimInput(body, request, trustProxy));
      writeJson(response, receipt.status === "confirmed" ? 200 : 202, receipt);
    } catch (error) {
      if (error instanceof RequestInputError) {
        writeJson(response, error.statusCode, { error: "invalid-request", message: error.message });
        return;
      }
      if (error instanceof FaucetError) {
        const headers: Record<string, string> = {};
        if (error.retryAfterSeconds) headers["retry-after"] = error.retryAfterSeconds.toString();
        writeJson(response, error.statusCode, {
          error: error.code,
          message: error.message,
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        }, headers);
        return;
      }

      writeJson(response, 503, {
        error: "provider-error",
        message: "The faucet provider is temporarily unavailable.",
      });
    }
  });
}

if (process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.API_PORT ?? "8787");
  const server = createApiServer();
  server.listen(port, "127.0.0.1", () => {
    console.log("[Cambrian API] listening on http://127.0.0.1:" + port);
  });
}
