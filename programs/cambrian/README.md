# Cambrian program: wallet ownership upgrade

This directory contains the C program, ABI, and build configuration for the
proposed wallet-owned Birth upgrade. It has not been deployed by this change.
The baseline is the previously verified Cambrian source in
[Thru-betanet-program](https://github.com/Alice699/Thru-betanet-program).

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
