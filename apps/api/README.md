# Cambrian API

API boundary for server-only operations such as the native Betanet faucet.

Run the frontend and local API together from the repository root:

    npm run dev

The launcher waits for the API health check before starting the frontend and
reuses an already running Cambrian API. To run only the API:

    npm run api:dev

The default server listens on 127.0.0.1:8787 (or API_PORT). When VITE_API_URL is empty, the
web app calls /api on its own origin. Vite forwards those requests to the API,
so a change of local frontend port does not cause a CORS failure. Restart the
Vite dev server after adding or changing its proxy configuration. In production,
route /api to this service or set VITE_API_URL to the API origin.

The frontend checks GET /health through that same API origin before submitting
a claim. An unavailable API, missing production route, or disabled provider
produces an actionable error without sending a payout request. An uncertain
response after submission still uses read-only balance reconciliation.

The faucet is deliberately disabled until an amount and a payout provider are
configured:

- FAUCET_AMOUNT_UNITS
- one of FAUCET_PROVIDER_URL or FAUCET_CLI_ENABLED=true

FAUCET_PROVIDER_URL must point to an approved internal payout service that owns
the faucet signer. The browser never receives that token.

For local development, the API can call the official Thru CLI directly using
the signer already configured in the local CLI profile:

    FAUCET_AMOUNT_UNITS=100
    FAUCET_CLI_ENABLED=true
    FAUCET_CLI_PATH=thru.cmd       # Windows; use `thru` on macOS/Linux
    FAUCET_CLI_RPC_URL=https://rpc.betanet.thru.org
    FAUCET_CLI_FEE_PAYER=default

The API loads the root `.env` automatically when running `npm run api:dev`.
`FAUCET_CLI_FEE_PAYER` must name a valid local CLI account with permission to
pay the faucet withdrawal. Never expose the CLI profile or private keys to the
browser, and do not enable this local signer on a public server.

The API returns 503 instead of pretending success when the provider is missing
or the CLI command fails.

Cambrian accepts the account selected in the official Thru Wallet. It no longer
creates browser-local wallets or provisions accounts with a local private key.
The frontend distinguishes a confirmed payout from an accepted or uncertain
response. Balance reconciliation and the Check status action are read-only;
they never submit another claim automatically.
