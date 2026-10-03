# Cambrian API

API boundary for server-only operations such as the native Betanet faucet.

Run the local API with:

    npm run api:dev

The default server listens on 127.0.0.1:8787. The web app uses that address
automatically in Vite development when VITE_API_URL is empty. In production,
set VITE_API_URL to the reverse-proxied API origin or keep it empty and route
/api to this service.

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
