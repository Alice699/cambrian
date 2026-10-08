import { Pubkey, type Transaction } from "@thru/sdk";
import { MulticallArgs, MULTICALL_PROGRAM_ADDRESS } from "@thru/programs/multicall";
import { PASSKEY_MANAGER_PROGRAM_ADDRESS } from "@thru/programs/passkey-manager";
import { PasskeyInstruction } from "@thru/sdk/programs/passkey-manager/abi/thru/program/passkey_manager/types";

export type AccountActivityKind = "wallet-create" | "credential-register" | "wallet-transfer" | "wallet-security"
  | "birth" | "pulse" | "encounter" | "reproduce" | "transfer-control" | "batch" | "network" | "unknown";

export interface AccountTransactionActivity {
  kind: AccountActivityKind;
  category: "wallet" | "cambrian" | "network" | "mixed" | "unknown";
  label: string;
  description: string;
  /** Recognized Cambrian calls, not wallet setup, funding, or authorization wrappers. */
  cambrianActionCount: number;
}

type ActivityTransaction = Pick<Transaction, "feePayer" | "program" | "readWriteAccounts" | "readOnlyAccounts" | "instructionData">;
type Action = { kind: AccountActivityKind; category: AccountTransactionActivity["category"]; label: string };

const unknownActivity = (): AccountTransactionActivity => ({
  kind: "unknown", category: "unknown", label: "Network transaction",
  description: "Transaction details unavailable", cambrianActionCount: 0,
});

/** Decode only known program layouts. Never guess an action from a signature, slot, or account reference. */
export function identifyAccountTransaction(
  transaction: ActivityTransaction,
  options: { walletAddress: string; cambrianProgramId?: string; confirmed: boolean },
): AccountTransactionActivity {
  try {
    const data = transaction.instructionData;
    if (!data?.length || data.length > 1_048_576) return unknownActivity();
    const wallet = Pubkey.from(options.walletAddress).toThruFmt();
    const accounts = [transaction.feePayer, transaction.program,
      ...(transaction.readWriteAccounts ?? []), ...(transaction.readOnlyAccounts ?? [])].map(key => key.toThruFmt());
    const accountAt = (index: number): string => {
      if (!accounts[index]) throw new Error("Instruction references an unavailable account");
      return accounts[index];
    };
    let remainingCalls = 64;
    const walk = (program: string, bytes: Uint8Array, depth: number): Action[] => {
      if (depth > 4 || --remainingCalls < 0 || !bytes.length) throw new Error("Unsupported instruction layout");
      if (program === MULTICALL_PROGRAM_ADDRESS) {
        const validation = MulticallArgs.validate(bytes);
        if (!validation.ok || validation.consumed !== bytes.length) throw new Error("Incomplete multicall");
        const batch = MulticallArgs.from_array(bytes);
        if (!batch || batch.calls_count > remainingCalls || batch.calls_count === 0) throw new Error("Unsupported batch size");
        return [...batch.callsIter()].flatMap(call => walk(accountAt(call.program_idx), Uint8Array.from(call.data), depth + 1));
      }
      if (program === PASSKEY_MANAGER_PROGRAM_ADDRESS) {
        if (bytes.length < 3) throw new Error("Incomplete wallet instruction");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const walletIndex = view.getUint16(1, true);
        const instructionWallet = accountAt(walletIndex);
        if (bytes[0] === 1) {
          const validation = PasskeyInstruction.validate(bytes);
          if (!validation.ok || validation.consumed !== bytes.length) throw new Error("Incomplete wallet authorization");
          const args = PasskeyInstruction.from_array(bytes)?.payload().asValidate();
          if (!args) throw new Error("Unsupported wallet authorization");
          const target = args.target_instruction;
          return walk(accountAt(target.program_idx), Uint8Array.from(target.data), depth + 1);
        }
        // Both current AuthorityRecord and deployed legacy Authority CREATE formats
        // share this prefix. Do not retain or expose credential/authentication bytes.
        if (bytes[0] === 0 && bytes.length >= 101 && (bytes[3] === 1 || bytes[3] === 2) && instructionWallet === wallet) {
          return [{ kind: "wallet-create", category: "wallet", label: "Wallet creation" }];
        }
        if (bytes[0] === 6 && bytes.length >= 38 && instructionWallet === wallet) {
          accountAt(view.getUint16(3, true));
          return [{ kind: "credential-register", category: "wallet", label: "Passkey registration" }];
        }
        if (bytes[0] === 2 && bytes.length === 13) {
          const recipient = accountAt(view.getUint16(3, true));
          if (instructionWallet === wallet || recipient === wallet) return [{ kind: "wallet-transfer", category: "wallet", label: "THRU transfer" }];
        }
        if (((bytes[0] === 4 && bytes.length >= 68) || (bytes[0] === 5 && bytes.length === 4)) && instructionWallet === wallet) {
          return [{ kind: "wallet-security", category: "wallet", label: "Wallet security update" }];
        }
        throw new Error("Unrecognized wallet instruction");
      }
      if (options.cambrianProgramId && program === options.cambrianProgramId) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const fixed = bytes[0] === 0 ? 71 : bytes[0] === 5 ? 73 : bytes[0] === 3 ? 75 : null;
        if (fixed !== null) {
          if (bytes.length < fixed || fixed + view.getUint32(fixed - 4, true) !== bytes.length) throw new Error("Incomplete Cambrian proof");
        } else if (bytes.length !== ({ 1: 11, 2: 13, 4: 5 } as Record<number, number>)[bytes[0]]) {
          throw new Error("Unrecognized Cambrian instruction");
        }
        const action = ({
          0: ["birth", "Organism birth"], 5: ["birth", "Organism birth"],
          1: ["pulse", "Organism pulse"], 2: ["encounter", "Organism encounter"],
          3: ["reproduce", "Organism reproduction"], 4: ["transfer-control", "Organism controller transfer"],
        } as Record<number, [AccountActivityKind, string]>)[bytes[0]];
        if (!action) throw new Error("Unknown Cambrian action");
        return [{ kind: action[0], category: "cambrian", label: action[1] }];
      }
      return [{ kind: "network", category: "network", label: "Other network activity" }];
    };
    const actions = walk(transaction.program.toThruFmt(), data, 0);
    const cambrianActionCount = actions.filter(action => action.category === "cambrian").length;
    const setup = actions.some(action => action.kind === "wallet-create")
      && actions.every(action => action.kind === "wallet-create" || action.kind === "credential-register");
    const primary = setup ? actions.find(action => action.kind === "wallet-create")! : actions[0];
    const single = setup || actions.length === 1;
    const category = setup ? "wallet" : new Set(actions.map(action => action.category)).size === 1 ? primary.category : "mixed";
    return {
      kind: single ? primary.kind : "batch", category,
      label: setup ? (options.confirmed ? "Wallet created" : "Wallet creation")
        : single && primary.kind === "credential-register" && options.confirmed ? "Passkey registered"
        : single ? primary.label : "Batch transaction",
      description: setup && actions.some(action => action.kind === "credential-register") ? "Account creation · Passkey registration"
        : single ? ({ wallet: "Thru Wallet activity", cambrian: "Cambrian organism action", network: "Other on-chain activity" } as Record<string, string>)[category] ?? "On-chain activity"
        : actions.map(action => action.label).join(" · "),
      cambrianActionCount,
    };
  } catch {
    // Malformed, missing, or newer layouts stay visible without fabricated labels/counts.
    return unknownActivity();
  }
}

export function summarizeAccountActivity(transactions: readonly {
  status: "confirmed" | "pending" | "failed" | "unavailable";
  activity: AccountTransactionActivity;
}[]) {
  return {
    walletTransactions: transactions.length,
    confirmedCambrianActions: transactions.reduce((count, transaction) => count
      + (transaction.status === "confirmed" ? transaction.activity.cambrianActionCount : 0), 0),
    incompleteConfirmedDetails: transactions.some(transaction => transaction.status === "confirmed" && transaction.activity.category === "unknown"),
  };
}
