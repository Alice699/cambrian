# Cambrian

A wallet-first dapp for living on-chain state on Thru Betanet.

Cambrian connects to the official Thru Wallet, displays native THRU balances
and account activity, and makes the organism transaction lifecycle visible.

## Features

- Official Thru-hosted wallet button and account menu, with no custom wallet popup
- Live native THRU balance in the official wallet control
- Organism discovery filtered by the selected wallet's on-chain controller
- Loading skeletons, clear empty states, and read-only retry actions
- Animated transaction steps: approval → submission → confirmation → readable state
- Green confirmed, yellow pending, and red failed feedback with text and icons
- Faucet API with validation, cooldown, rate limits, and idempotent claims
- Compact public addresses with full-value copy and network-aware explorer links

Cambrian no longer offers a local wallet. Previously stored local vaults are
not erased by this change; the removed source remains recoverable in Git history.

## Run locally

Requires Node.js 22 or newer and npm.

    npm install
    npm run api:dev

In another terminal:

    npm run dev

Open http://127.0.0.1:5173. The API listens on http://127.0.0.1:8787.
The Vite proxy forwards same-origin /api requests to the API.

## Configuration

Use [.env.example](.env.example) as the reference. Public Betanet deployment
defaults are included; a local .env is needed only to override configuration
or configure a faucet provider.

Important frontend variables:

- VITE_CAMBRIAN_PROGRAM_ID and VITE_CAMBRIAN_ABI_ID
- VITE_THRU_RPC_URL, VITE_THRU_WALLET_IFRAME_URL, and VITE_THRU_EXPLORER_URL
- VITE_API_URL
- VITE_CAMBRIAN_WALLET_BIRTH_ENABLED (false until the ownership upgrade is verified)

Faucet configuration is server-only. See [API setup](apps/api/README.md).
Never put private keys, recovery phrases, passkey authentication material, or
provider credentials in VITE-prefixed variables or commit them to Git.

## Current Betanet status

Thru Wallet approval, submission, execution, and account decoding were exercised
with a confirmed Birth on the existing deployment. Faucet funding was also
tested through Thru Wallet.

The legacy Birth instruction records the network fee payer as the organism
controller, which can differ from the selected managed wallet. The new
wallet_birth instruction and ABI are prepared locally to address this.
New wallet-owned Birth is deliberately disabled until that program and ABI
upgrade is deployed and verified. Enabling the frontend flag alone is not an
upgrade.

Existing organism accounts remain on-chain. A program upgrade does not
automatically change their controller; any transfer must be separately reviewed
and approved by the currently authorized controller.

| Resource | Current deployment |
| --- | --- |
| Program | `taLnTXq4qblEsC-HkN4QG35Lp72Vnle8gk8UkiAtASymFD` |
| ABI | `taPciIseW9AzTnNaB6VJyhHkiOwEDfZYwUbdPdfvbvUQuS` |

See the [program release checklist](programs/cambrian/README.md) before enabling
the new instruction.

## Development

| Command | Purpose |
| --- | --- |
| npm run dev | Start the web app |
| npm run api:dev | Start the faucet API |
| npm run test | Run SDK, ownership, transaction UI, and faucet tests |
| npm run typecheck | Check the web app |
| npm run api:typecheck | Check the API |
| npm run build | Build the production web app |

    apps/web/                  React, TypeScript, and Vite interface
    apps/api/                  Server-only faucet service
    packages/cambrian-sdk/      Instruction builders and chain services
    packages/wallet-core/       Official wallet configuration and metadata
    packages/config/           Shared Betanet defaults
    programs/cambrian/          C program source and ownership-upgrade ABI
    tests/                     Offline regression and component-render tests

## Transaction safety

Wallet approval is not network confirmation. Birth is shown as complete only
after successful execution and a readable organism with the expected controller.
Pending public receipts are scoped to the wallet and program in sessionStorage.
Checking a pending transaction or faucet claim never signs or sends it again.

Missing deployment or payout configuration fails closed. Betanet assets are
for testing only.

[Thru documentation](https://thru.org/docs/) ·
[Thru explorer](https://scan.thru.org/)
