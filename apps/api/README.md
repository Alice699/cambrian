# Cambrian API

API boundary for server-only operations such as the native Betanet faucet.

Run the local API with:

    npm run api:dev

The default server listens on 127.0.0.1:8787. The web app uses that address
automatically in Vite development when VITE_API_URL is empty. In production,
set VITE_API_URL to the reverse-proxied API origin or keep it empty and route
/api to this service.

The faucet is deliberately disabled until all of these server-only settings
are supplied:

- FAUCET_AMOUNT_UNITS
- FAUCET_PROVIDER_URL
- optional FAUCET_PROVIDER_TOKEN

FAUCET_PROVIDER_URL must point to an approved internal payout service that owns
the faucet signer or CLI credentials. The browser never receives that token.
The API returns 503 instead of pretending success when the provider is missing.
