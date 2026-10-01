import assert from "node:assert/strict";
import test from "node:test";
import {
  FaucetError,
  FaucetService,
  UnavailableFaucetProvider,
  createFaucetPolicyFromEnv,
  type FaucetPayoutProvider,
} from "../apps/api/src/faucet.ts";

const address = "ta" + "ab".repeat(21);

function createProvider(status: "submitted" | "confirmed" = "confirmed") {
  let calls = 0;
  const provider: FaucetPayoutProvider = {
    configured: true,
    async requestPayout() {
      calls += 1;
      return { status, signature: "sig-" + calls };
    },
  };
  return { provider, getCalls: () => calls };
}

test("faucet policy stays disabled until an amount is configured", () => {
  const policy = createFaucetPolicyFromEnv({});
  assert.equal(policy.amount, 0n);
  assert.equal(policy.maxRequestsPerWindow, 3);
});

test("faucet claim is idempotent and does not pay twice", async () => {
  const { provider, getCalls } = createProvider();
  const auditEvents: string[] = [];
  const service = new FaucetService({
    policy: {
      amount: 1000n,
      cooldownMs: 60_000,
      windowMs: 60_000,
      maxRequestsPerWindow: 3,
    },
    provider,
    createRequestId: () => "request-1",
    onAudit: (event) => auditEvents.push(event.type),
  });

  const first = await service.claim({
    address,
    ip: "127.0.0.1",
    idempotencyKey: "claim-0001",
  });
  const replay = await service.claim({
    address,
    ip: "127.0.0.1",
    idempotencyKey: "claim-0001",
  });

  assert.equal(first.status, "confirmed");
  assert.deepEqual(replay, first);
  assert.equal(getCalls(), 1);
  assert.deepEqual(auditEvents, ["claim.accepted", "claim.completed"]);
});

test("faucet enforces address cooldown and IP rate limit", async () => {
  const { provider } = createProvider("submitted");
  let now = 1_000;
  const service = new FaucetService({
    policy: {
      amount: 500n,
      cooldownMs: 10_000,
      windowMs: 60_000,
      maxRequestsPerWindow: 2,
    },
    provider,
    now: () => now,
    createRequestId: () => "request-" + now,
  });

  await service.claim({ address, ip: "10.0.0.1" });
  await assert.rejects(
    () => service.claim({ address, ip: "10.0.0.1" }),
    (error: unknown) => error instanceof FaucetError && error.code === "cooldown",
  );

  now += 11_000;
  await service.claim({ address: address.replace("ta", "tb"), ip: "10.0.0.1" });
  now += 11_000;
  await assert.rejects(
    () => service.claim({ address: address.replace("ta", "tc"), ip: "10.0.0.1" }),
    (error: unknown) => error instanceof FaucetError && error.code === "rate-limited",
  );
});

test("unconfigured faucet never reports a successful payout", async () => {
  const service = new FaucetService({
    policy: {
      amount: 1000n,
      cooldownMs: 0,
      windowMs: 60_000,
      maxRequestsPerWindow: 3,
    },
    provider: new UnavailableFaucetProvider(),
  });

  await assert.rejects(
    () => service.claim({ address, ip: "127.0.0.1" }),
    (error: unknown) => error instanceof FaucetError && error.code === "not-configured" && error.statusCode === 503,
  );
});
