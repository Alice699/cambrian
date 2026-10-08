# Cambrian program: wallet ownership upgrade

This directory contains the C program, ABI, and build configuration for the
wallet-owned Birth upgrade deployed to the existing Betanet program on 2026-10-08.
Program version 1 and ABI revision 1 were read back and matched the reviewed
binary and publish-ready ABI byte-for-byte. A manually approved Thru Wallet Birth
at slot 622115 completed all four UI steps. Read-only RPC verification confirmed
VM and program errors are both zero and the organism controller is the selected
managed wallet, not its fee payer. Live UI account-switching verification remains
pending, distinct from the successful RPC ownership-isolation checks.
The baseline is the previously verified Cambrian source in
[Thru-betanet-program](https://github.com/Alice699/Thru-betanet-program).

The [release record](wallet-birth-release.json) contains public addresses, hashes,
and upgrade signatures only. No legacy organism controller was transferred.

## Compatibility

- The organism stays version 1 with its existing 264-byte layout.
- Legacy instruction tags 0–4 and their argument layouts remain unchanged.
- Tag 5, `wallet_birth`, adds an explicit `controller_account_idx` after
  `organism_account_idx`; the fixed argument prefix is 72 bytes.
- Managed account and organism indices follow the official Passkey Manager
  account ordering, not fixed positions or the network fee payer.
- Before creating an organism, the program requires an existing controller
  account and runtime authorization for that controller public key. Fee-payer
  index 0, program index 1, and the organism itself are rejected for wallet Birth.
- Hashes, events, future controller checks, and children use the stored controller.

Changing a frontend filter cannot repair legacy account ownership. Upgrading
the program also cannot rewrite existing controllers automatically.

## Offline checks

Install the official Thru C SDK and RISC-V toolchain in the Linux/WSL environment.
The makefile defaults to the installation under `~/.thru/sdk/`.

Run from this directory, using a serial build:

    make

The output is `build/thruvm/bin/cambrian_c.bin`. Build artifacts are ignored by Git.
The controller test invokes the same production C authorization helper with a
mock runtime. It is an offline regression test, not a live VM integration test.

    gcc -std=c17 -Wall -Wextra -Werror tests/controller_test.c -o build/controller_test
    ./build/controller_test
    thru abi analyze --files cambrian.abi.yaml --quiet

Run the SDK and UI regression tests from the repository root:

    npm run test
    npm run typecheck
    npm run api:typecheck
    npm run build

## Reproduce the release verification

Build into a separate directory in Linux/WSL:

    make -j1 BASEDIR="$PWD/build/release-verification"

Then run from the repository root:

    thru abi codegen --files programs/cambrian/cambrian.abi.yaml --language typescript --output programs/cambrian/build/release-verification/generated
    thru abi prep-for-publish --file programs/cambrian/cambrian.abi.yaml --target-network betanet --output programs/cambrian/build/release-verification/cambrian.publish.abi.yaml
    node --experimental-strip-types --import ./tests/register-typescript.mjs programs/cambrian/scripts/check-birth-abi-roundtrip.mjs
    node programs/cambrian/scripts/verify-wallet-birth-release.mjs after

The roundtrip script compares 12 synthetic SDK payloads with the official ABI
code-generated builders, including byte-sorted account indices and legacy tag 0.
Use `thru abi reflect --type-name CambrianInstruction --validate-only` on the
generated `.bin` fixtures for CLI validation. These payloads contain synthetic
proof bytes and must never be submitted to the chain.

The release verifier is read-only on-chain and checks exact deployment addresses,
authority, state, versions, and artifact hashes. Its `before` mode applies only to
the original version-0 release and archived that binary and ABI locally without
overwriting existing backups. Generated artifacts and backups are ignored by Git.

## Release checklist — requires separate approval

1. Confirm the exact Betanet program, ABI, deployment authority, and intended
   binary/ABI hashes before any signed operation.
2. Upgrade the existing program with the tag-5-compatible binary. If a new
   program is needed instead, explicitly choose that migration and update IDs;
   do not silently abandon the existing organism accounts.
3. Publish the matching ABI, read it back, and verify the binary and ABI contents.
4. Update public deployment configuration. Set
   `VITE_CAMBRIAN_WALLET_BIRTH_ENABLED=true` only after verification; restart or
   rebuild the frontend so the new configuration is applied.
5. Manually approve one Birth in Thru Wallet. Verify the selected managed account
   is stored in `controller`, the transaction succeeded, and all four UI steps
   finish after the organism is readable.
6. Switch between two wallet accounts and an empty account. Verify each view
   exposes only its own controller records, balances, and pending receipts.
7. For each legacy organism, inspect its current controller and intended new
   controller. Use the existing `transfer_control` instruction only with explicit
   approval and authorization from the current controller. Never transfer all
   fee-payer-controlled organisms to the first connected wallet automatically.

No deployment credentials, wallet secrets, or signed wire transactions belong
in this directory. Deployment and controller transfers are not run by tests.
