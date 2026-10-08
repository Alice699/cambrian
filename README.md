# Cambrian

A wallet-first dapp for living on-chain state on Thru Betanet.

Cambrian connects to the official Thru Wallet, displays native THRU balances
and account activity, and makes the organism transaction lifecycle visible.

## Features

- Instant wallet launcher with the original Thru logo and official Thru-hosted account menu
- Persistent dashboard header and wallet balance across app pages; no wallet controls on landing
- Live native THRU balance in the official wallet control
- Organism discovery filtered by the selected wallet's on-chain controller
- Loading skeletons, clear empty states, and read-only retry actions
- Animated transaction steps: approval → submission → confirmation → readable state
- Green confirmed, yellow pending, and red failed feedback with text and icons
- Faucet API with validation, cooldown, rate limits, and idempotent claims
- Compact public addresses with full-value copy and network-aware explorer links
- Named wallet setup, transfers, and Cambrian actions, decoded from on-chain instructions
- Separate recent wallet transaction and confirmed Cambrian action counts; failed/pending requests stay visible without counting as successful actions
- Cursor-paginated Activity with 10 records per page, cached back navigation, and wallet-scoped refresh/retry

Cambrian no longer offers a local wallet. Previously stored local vaults are
not erased by this change; the removed source remains recoverable in Git history.

The app styles only the launcher button. Account switching, account management,
connection approval, and signing remain inside the official Thru Wallet UI.

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
- VITE_CAMBRIAN_WALLET_BIRTH_ENABLED (defaults to true for the verified release; false pauses new Births)

Faucet configuration is server-only. See [API setup](apps/api/README.md).
Never put private keys, recovery phrases, passkey authentication material, or
provider credentials in VITE-prefixed variables or commit them to Git.

## Current Betanet status

Thru Wallet approval, submission, execution, and account decoding were exercised
with a confirmed Birth on the existing deployment. Faucet funding was also
tested through Thru Wallet.

The legacy Birth instruction records the network fee payer as the organism
controller, which can differ from the selected managed wallet. On 2026-10-08,
the same program was upgraded to version 1 and its ABI to revision 1 with the
new wallet_birth instruction. Both on-chain artifacts were read back and matched
the reviewed local bytes. Wallet-owned Birth is enabled for this exact program,
ABI, and Betanet RPC; unverified deployment overrides remain disabled unless
explicitly enabled. An explicit false frontend flag still pauses new Births.

The upgraded flow completed a user-approved Birth in official Thru Wallet at
slot 622115 on 2026-10-08. All four UI steps completed, and read-only RPC checks
confirmed successful execution and a readable organism with the selected managed
wallet stored as controller, not the fee payer (energy 2048, vitality 975).
Wallet-scoped RPC discovery includes it for the managed wallet and excludes it
for the fee payer. Public account bytes are preserved as a regression fixture.
Live wallet A/B/empty-account switching in the UI still needs manual verification;
offline isolation tests do not substitute for that check. See the
[public release record](programs/cambrian/wallet-birth-release.json).

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
| npm run test | Run SDK, ownership, transaction UI, wallet navigation DOM, and faucet tests |
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
