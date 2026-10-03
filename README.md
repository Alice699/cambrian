# Cambrian

Cambrian is a wallet-first dapp for Thru Betanet. It gives users a visual
interface for creating an account, requesting test funds, reading on-chain
activity, and interacting with persistent Cambrian organisms without using the
CLI.

> Cambrian is under active development. A fresh Cambrian program and ABI are
> deployed and verified on Betanet; live wallet approval is still experimental.

## Features

- Encrypted browser-local self-custodial wallet with optional Thru Wallet fallback
- Native account balance and transaction reads
- Cambrian organism account discovery and decoding
- Guarded Birth transaction lifecycle
- Faucet API boundary with validation, cooldown, rate limiting, idempotency,
  audit events, and server-only provider credentials
- Responsive landing page and routed dashboard

## Stack

- React, TypeScript, and Vite
- Thru SDK, local HD wallet primitives, and hosted wallet fallback
- Three.js with React Three Fiber
- Node.js API using the built-in HTTP server
- npm workspaces

## Quick start

Requirements:

- Node.js 22 or newer
- npm

Install dependencies:

    npm install

Start the API:

    npm run api:dev

Start the web app in another terminal:

    npm run dev

Open http://127.0.0.1:5173.

The API runs at http://127.0.0.1:8787. Without a configured payout provider,
the faucet endpoint intentionally returns 503 instead of reporting a false
success.

## Configuration

Use .env.example as the reference for supported variables. The repository
defaults already point at the verified Betanet deployment; VITE-prefixed values
can override them for another environment.

Important frontend variables:

- VITE_CAMBRIAN_PROGRAM_ID
- VITE_CAMBRIAN_ABI_ID
- VITE_THRU_RPC_URL
- VITE_THRU_WALLET_IFRAME_URL
- VITE_THRU_EXPLORER_URL
- VITE_API_URL

Important API-only variables:

- FAUCET_AMOUNT_UNITS
- FAUCET_PROVIDER_URL or FAUCET_CLI_ENABLED
- FAUCET_PROVIDER_TOKEN (HTTP provider only)
- FAUCET_CLI_PATH
- FAUCET_CLI_RPC_URL
- FAUCET_CLI_FEE_PAYER
- FAUCET_COOLDOWN_MS
- FAUCET_RATE_WINDOW_MS
- FAUCET_RATE_MAX

Never expose faucet credentials or signing material through VITE-prefixed
variables. For local CLI payouts, keep the Thru CLI profile on the server
machine and never put its keys in `.env` or browser code.

## Commands

| Command | Purpose |
| --- | --- |
| npm run dev | Start the web development server |
| npm run api:dev | Start the local API |
| npm run test | Run SDK and faucet tests |
| npm run typecheck | Type-check the web app |
| npm run api:typecheck | Type-check the API |
| npm run build | Create the production web build |

## Repository structure

    apps/
      web/                 React dapp
      api/                 Server-only faucet boundary
    packages/
      cambrian-sdk/        Instruction builders, decoders, and chain services
      config/              Shared Betanet configuration
      wallet-core/         Local vault, Thru signer, and hosted wallet integration
    tests/                 SDK and faucet tests

## Current status

The interface, wallet integration, encrypted local-wallet foundation, read
services, guarded Birth flow, and faucet boundary are implemented. The fresh
program and ABI are live on Betanet, and the published ABI was read back and
matched locally. Live Birth still needs wallet end-to-end verification, while
faucet payouts still need an approved native-faucet provider.

### Wallet custody modes

Cambrian currently exposes two signing paths:

The wallet is intentionally presented as an in-context popover from the app
wallet trigger, similar to an extension wallet. There is no separate wallet
dashboard route; the current page stays visible while account actions are
opened and closed.

- **Local self-custody:** a Thru BIP39/HD account is created or restored in the
  browser. The encrypted vault is stored in IndexedDB using PBKDF2 + AES-GCM;
  the private key is held in memory only while the wallet is unlocked. The
  recovery phrase is shown once and is never sent to Cambrian's API.
- **Hosted Thru Wallet:** the existing embedded Thru Wallet flow remains
  available as a fallback for users who prefer managed wallet/passkey UX.

The local wallet uses Thru's official key derivation, Ed25519 signing, and
transaction builder primitives. Cambrian does not implement its own key
algorithm or transaction wire format. This is an early self-custody slice and
still needs browser QA, account funding, and a live Betanet Birth smoke test
before it should be treated as production-ready.

### Verified Betanet deployment

| Resource | Address | Status |
| --- | --- | --- |
| Cambrian program | `taLnTXq4qblEsC-HkN4QG35Lp72Vnle8gk8UkiAtASymFD` | Live |
| Cambrian ABI | `taPciIseW9AzTnNaB6VJyhHkiOwEDfZYwUbdPdfvbvUQuS` | Published and read back |
| Program binary | SHA-256 `9B22018403F4CA745E22B5F13A71B63E7F01423FC75AF18423D3F89D5F3359AD` | Verified |

Explorer links:

- [Program account](https://scan.thru.org/address/taLnTXq4qblEsC-HkN4QG35Lp72Vnle8gk8UkiAtASymFD?rpc=https%3A%2F%2Frpc.betanet.thru.org)
- [ABI account](https://scan.thru.org/address/taPciIseW9AzTnNaB6VJyhHkiOwEDfZYwUbdPdfvbvUQuS?rpc=https%3A%2F%2Frpc.betanet.thru.org)

## Security

- Local wallet secrets are encrypted at rest in IndexedDB; plaintext private
  keys are held only in memory while the wallet is unlocked and cleared on lock.
- Recovery phrases are never sent to the Cambrian API and are not included in
  the public wallet snapshot.
- Hosted-wallet approval remains an optional signing boundary for that mode.
- Faucet provider credentials stay on the API server.
- Missing deployment or faucet configuration fails closed.

## Links

- Thru documentation: https://thru.org/docs/
- Thru explorer: https://scan.thru.org/
- Cambrian program reference: https://github.com/Alice699/Thru-betanet-program
