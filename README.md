# Cambrian

Cambrian is a wallet-first dapp for Thru Betanet. It gives users a visual
interface for creating an account, requesting test funds, reading on-chain
activity, and interacting with persistent Cambrian organisms without using the
CLI.

> Cambrian is under active development. The current program and ABI IDs remain
> unset until a fresh Betanet deployment is verified.

## Features

- Thru wallet and passkey connection
- Native account balance and transaction reads
- Cambrian organism account discovery and decoding
- Guarded Birth transaction lifecycle
- Faucet API boundary with validation, cooldown, rate limiting, idempotency,
  audit events, and server-only provider credentials
- Responsive landing page and routed dashboard

## Stack

- React, TypeScript, and Vite
- Thru SDK and hosted wallet
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

Use .env.example as the reference for supported variables.

Important frontend variables:

- VITE_CAMBRIAN_PROGRAM_ID
- VITE_CAMBRIAN_ABI_ID
- VITE_THRU_RPC_URL
- VITE_THRU_WALLET_IFRAME_URL
- VITE_THRU_EXPLORER_URL
- VITE_API_URL

Important API-only variables:

- FAUCET_AMOUNT_UNITS
- FAUCET_PROVIDER_URL
- FAUCET_PROVIDER_TOKEN
- FAUCET_COOLDOWN_MS
- FAUCET_RATE_WINDOW_MS
- FAUCET_RATE_MAX

Never expose faucet credentials or signing material through VITE-prefixed
variables.

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
      wallet-core/         Thru wallet integration
    tests/                 SDK and faucet tests

## Current status

The interface, wallet integration, read services, guarded Birth flow, and
faucet boundary are implemented. Live Birth and faucet payouts still require
verified Betanet deployment IDs and an approved native-faucet provider.

## Security

- Private keys are never stored by the frontend.
- Wallet approval remains the signing boundary for user transactions.
- Faucet provider credentials stay on the API server.
- Missing deployment or faucet configuration fails closed.

## Links

- Thru documentation: https://thru.org/docs/
- Thru explorer: https://scan.thru.org/
- Cambrian program reference: https://github.com/Alice699/Thru-betanet-program
