import { createThruClient, Pubkey, signMessage as signThruMessage, Signature, type Thru } from "@thru/sdk";
import { getWebCrypto, MnemonicGenerator, ThruHDWallet } from "@thru/sdk/crypto";
import type { ThruTransactionIntent } from "@thru/wallet";

const LOCAL_WALLET_DB_NAME = "cambrian-local-wallet";
const LOCAL_WALLET_STORE_NAME = "wallet";
const LOCAL_WALLET_STORAGE_KEY = "primary";
const LEGACY_LOCAL_WALLET_RECORD_VERSION = 1 as const;
const LOCAL_WALLET_RECORD_VERSION = 2 as const;
const PBKDF2_ITERATIONS = 310_000;
const AES_KEY_LENGTH = 256;
const PASSWORD_MIN_LENGTH = 8;
const DEFAULT_WALLET_PREFIX = "Wallet";

export interface LocalWalletAccount {
  address: string;
  publicKey: string;
  path: string;
  index: number;
}

/** Version 1 remains readable so existing browser vaults can be upgraded. */
export interface EncryptedLocalWalletRecord {
  version: typeof LEGACY_LOCAL_WALLET_RECORD_VERSION;
  account: LocalWalletAccount;
  createdAt: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
    ciphertext: string;
  };
}

export interface EncryptedLocalWalletEntry {
  id: string;
  name: string;
  account: LocalWalletAccount;
  createdAt: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
    ciphertext: string;
  };
}

export interface EncryptedLocalWalletVaultRecord {
  version: typeof LOCAL_WALLET_RECORD_VERSION;
  activeWalletId: string;
  wallets: EncryptedLocalWalletEntry[];
}

export type StoredLocalWalletRecord = EncryptedLocalWalletRecord | EncryptedLocalWalletVaultRecord;

export interface LocalWalletMetadata {
  id: string;
  name: string;
  account: LocalWalletAccount;
  createdAt: string;
}

export interface LocalWalletStorage {
  read(): Promise<StoredLocalWalletRecord | null>;
  write(record: StoredLocalWalletRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface LocalWalletSnapshot {
  status: "loading" | "absent" | "locked" | "unlocked";
  account: LocalWalletAccount | null;
  wallets: LocalWalletMetadata[];
  activeWalletId: string | null;
  error: string | null;
}

export interface LocalWalletCreationResult {
  account: LocalWalletAccount;
  wallet: LocalWalletMetadata;
  /** Show this once and ask the user to write it down. It is never persisted in plaintext. */
  recoveryPhrase: string;
}

export interface LocalAccountProvisionResult {
  created: boolean;
  signature?: string;
}

export interface LocalWalletSigner {
  readonly connected: boolean;
  readonly account: LocalWalletAccount;
  ensureAccount(): Promise<LocalAccountProvisionResult>;
  signTransaction(intent: ThruTransactionIntent): Promise<string>;
  signMessage(message: Uint8Array): Promise<string>;
  lock(): void;
}

/** Browser-backed storage for the encrypted wallet vault. */
export class IndexedDbLocalWalletStorage implements LocalWalletStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async read(): Promise<StoredLocalWalletRecord | null> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction(LOCAL_WALLET_STORE_NAME, "readonly")
        .objectStore(LOCAL_WALLET_STORE_NAME)
        .get(LOCAL_WALLET_STORAGE_KEY);
      request.onsuccess = () => resolve((request.result as StoredLocalWalletRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Local wallet storage could not be read"));
    });
  }

  async write(record: StoredLocalWalletRecord): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(LOCAL_WALLET_STORE_NAME, "readwrite")
        .objectStore(LOCAL_WALLET_STORE_NAME)
        .put(record, LOCAL_WALLET_STORAGE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Local wallet storage could not be written"));
    });
  }

  async clear(): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(LOCAL_WALLET_STORE_NAME, "readwrite")
        .objectStore(LOCAL_WALLET_STORE_NAME)
        .delete(LOCAL_WALLET_STORAGE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Local wallet storage could not be cleared"));
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is unavailable in this browser"));
    }

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(LOCAL_WALLET_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(LOCAL_WALLET_STORE_NAME)) {
          request.result.createObjectStore(LOCAL_WALLET_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
    });
    return this.databasePromise;
  }
}

/** Small deterministic storage double for unit tests and non-browser tooling. */
export class MemoryLocalWalletStorage implements LocalWalletStorage {
  private record: StoredLocalWalletRecord | null = null;

  async read(): Promise<StoredLocalWalletRecord | null> {
    return this.record ? cloneRecord(this.record) : null;
  }

  async write(record: StoredLocalWalletRecord): Promise<void> {
    this.record = cloneRecord(record);
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}

/** A local signing session whose private key is cleared when the wallet locks. */
export class LocalWalletSession implements LocalWalletSigner {
  private privateKey: Uint8Array | null;
  readonly account: LocalWalletAccount;
  private readonly client: Thru;

  constructor(account: LocalWalletAccount, client: Thru, privateKey: Uint8Array) {
    this.account = account;
    this.client = client;
    this.privateKey = new Uint8Array(privateKey);
  }

  get connected(): boolean {
    return this.privateKey !== null;
  }

  async ensureAccount(): Promise<LocalAccountProvisionResult> {
    const privateKey = this.requirePrivateKey();

    try {
      await this.client.accounts.get(this.account.address);
      return { created: false };
    } catch (error) {
      if (!isMissingAccountError(error)) throw error;
    }

    const transaction = await this.client.accounts.create({
      publicKey: this.account.address,
    });
    await transaction.sign(privateKey);
    const signature = await this.client.transactions.send(transaction);
    await waitForAccount(this.client, this.account.address);

    return { created: true, signature };
  }

  async signTransaction(intent: ThruTransactionIntent): Promise<string> {
    const privateKey = this.requirePrivateKey();
    if (intent.walletAddress && intent.walletAddress !== this.account.address) {
      throw new Error("Transaction wallet address does not match the selected local account");
    }

    const signed = await this.client.transactions.buildAndSign({
      feePayer: { publicKey: this.account.address, privateKey },
      program: intent.programAddress,
      accounts: {
        readWrite: intent.readWriteAddresses,
        readOnly: intent.readOnlyAddresses,
      },
      instructionData: base64ToBytes(intent.instructionData),
    });

    return bytesToBase64(signed.rawTransaction);
  }

  async signMessage(message: Uint8Array): Promise<string> {
    const signature = await signThruMessage(new Uint8Array(message), this.requirePrivateKey());
    return Signature.from(signature).toThruFmt();
  }

  lock(): void {
    if (!this.privateKey) return;
    this.privateKey.fill(0);
    this.privateKey = null;
  }

  private requirePrivateKey(): Uint8Array {
    if (!this.privateKey) throw new Error("Local wallet is locked");
    return this.privateKey;
  }
}

/**
 * Owns the encrypted local-wallet vault. Mnemonics never appear in a snapshot
 * or in storage as plaintext; create/add return a phrase once for backup.
 */
export class LocalWalletController {
  private readonly storage: LocalWalletStorage;
  private readonly client: Thru;
  private readonly listeners = new Set<() => void>();
  private sessions = new Map<string, LocalWalletSession>();
  private snapshot: LocalWalletSnapshot = {
    status: "loading",
    account: null,
    wallets: [],
    activeWalletId: null,
    error: null,
  };
  readonly ready: Promise<void>;

  constructor(options: { rpcUrl: string; storage?: LocalWalletStorage }) {
    this.storage = options.storage ?? new IndexedDbLocalWalletStorage();
    this.client = createThruClient({ baseUrl: options.rpcUrl });
    this.ready = this.refresh();
  }

  getSnapshot = (): LocalWalletSnapshot => this.snapshot;

  getServerSnapshot = (): LocalWalletSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSigner(): LocalWalletSigner | null {
    const activeWalletId = this.snapshot.activeWalletId;
    const session = activeWalletId ? this.sessions.get(activeWalletId) : null;
    return session?.connected ? session : null;
  }

  async create(password: string, name?: string): Promise<LocalWalletCreationResult> {
    await this.ready;
    assertPassword(password);
    if (this.snapshot.wallets.length > 0) {
      throw new Error("A local wallet already exists. Use Add wallet to create another account.");
    }
    return this.createEntry(password, name ?? `${DEFAULT_WALLET_PREFIX} 1`);
  }

  async restore(recoveryPhrase: string, password: string, name?: string): Promise<LocalWalletAccount> {
    await this.ready;
    assertPassword(password);
    if (this.snapshot.wallets.length > 0) {
      throw new Error("A local wallet already exists. Use Add wallet to import another account.");
    }
    const result = await this.createEntry(password, name ?? `${DEFAULT_WALLET_PREFIX} 1`, recoveryPhrase);
    return result.account;
  }

  /** Add a new encrypted account to the existing vault. */
  async add(password: string, name?: string, recoveryPhrase?: string): Promise<LocalWalletCreationResult> {
    await this.ready;
    assertPassword(password);
    if (this.snapshot.status !== "unlocked" || this.snapshot.wallets.length === 0) {
      throw new Error("Unlock the local wallet before adding another account");
    }
    const stored = await this.storage.read();
    const vault = normalizeStoredRecord(stored);
    const activeEntry = findWallet(vault.wallets, this.snapshot.activeWalletId ?? vault.activeWalletId);
    try {
      const existingPhrase = await decryptMnemonic(activeEntry, password);
      void existingPhrase;
    } catch {
      throw new Error("Wallet password does not match this vault");
    }
    return this.createEntry(password, name ?? nextWalletName(this.snapshot.wallets), recoveryPhrase, true);
  }

  async unlock(password: string): Promise<LocalWalletAccount> {
    await this.ready;
    assertPassword(password);
    const stored = await this.storage.read();
    if (!stored) throw new Error("No local wallet is stored on this device");

    const vault = normalizeStoredRecord(stored);
    const unlockedSessions = new Map<string, LocalWalletSession>();
    try {
      for (const entry of vault.wallets) {
        const mnemonic = await decryptMnemonic(entry, password);
        const derived = await deriveAccount(mnemonic, entry.account.index);
        if (derived.account.address !== entry.account.address) {
          derived.privateKey.fill(0);
          throw new Error("Local wallet metadata does not match its encrypted account");
        }
        unlockedSessions.set(entry.id, new LocalWalletSession(derived.account, this.client, derived.privateKey));
        derived.privateKey.fill(0);
      }
    } catch {
      unlockedSessions.forEach((session) => session.lock());
      throw new Error("Invalid wallet password or corrupted local wallet");
    }

    const activeWalletId = vault.wallets.some((entry) => entry.id === vault.activeWalletId)
      ? vault.activeWalletId
      : vault.wallets[0]?.id ?? null;
    if (!activeWalletId) throw new Error("Local wallet vault contains no accounts");

    this.sessions.forEach((session) => session.lock());
    this.sessions = unlockedSessions;
    this.setSnapshot({
      status: "unlocked",
      account: findWallet(vault.wallets, activeWalletId).account,
      wallets: toMetadata(vault.wallets),
      activeWalletId,
      error: null,
    });

    // Upgrade a v1 record only after the password successfully decrypts it.
    if (!isVaultRecord(stored)) await this.storage.write(vault);
    return this.snapshot.account as LocalWalletAccount;
  }

  async rename(walletId: string, name: string): Promise<LocalWalletMetadata> {
    await this.ready;
    const stored = await this.storage.read();
    if (!stored) throw new Error("No local wallet is stored on this device");
    const vault = normalizeStoredRecord(stored);
    const entry = vault.wallets.find((candidate) => candidate.id === walletId);
    if (!entry) throw new Error("Wallet account could not be found");

    entry.name = normalizeWalletName(name, entry.name);
    await this.storage.write(vault);
    this.setSnapshot({ ...this.snapshot, wallets: toMetadata(vault.wallets), error: null });
    return toMetadata([entry])[0];
  }

  async switchWallet(walletId: string): Promise<LocalWalletAccount> {
    await this.ready;
    const entry = this.snapshot.wallets.find((wallet) => wallet.id === walletId);
    if (!entry) throw new Error("Wallet account could not be found");
    if (this.snapshot.status !== "unlocked") throw new Error("Unlock the local wallet before switching accounts");
    const session = this.sessions.get(walletId);
    if (!session?.connected) throw new Error("Selected wallet is locked");

    const stored = await this.storage.read();
    if (!stored) throw new Error("No local wallet is stored on this device");
    const vault = normalizeStoredRecord(stored);
    vault.activeWalletId = walletId;
    await this.storage.write(vault);
    this.setSnapshot({ status: "unlocked", account: entry.account, wallets: toMetadata(vault.wallets), activeWalletId: walletId, error: null });
    return entry.account;
  }

  lock(): void {
    this.sessions.forEach((session) => session.lock());
    this.sessions.clear();
    if (this.snapshot.wallets.length > 0) {
      this.setSnapshot({ status: "locked", account: this.snapshot.account, wallets: this.snapshot.wallets, activeWalletId: this.snapshot.activeWalletId, error: null });
    }
  }

  async clear(): Promise<void> {
    await this.ready;
    this.lock();
    await this.storage.clear();
    this.setSnapshot({ status: "absent", account: null, wallets: [], activeWalletId: null, error: null });
  }

  private async createEntry(password: string, requestedName: string, recoveryPhrase?: string, append = false): Promise<LocalWalletCreationResult> {
    const normalizedPhrase = recoveryPhrase ? normalizePhrase(recoveryPhrase) : MnemonicGenerator.generate();
    if (recoveryPhrase && !MnemonicGenerator.validate(normalizedPhrase)) {
      throw new Error("Recovery phrase is not a valid Thru BIP39 phrase");
    }

    // Each wallet has its own recovery phrase, therefore each phrase starts at
    // its first account path. The UI index is a vault position, not a derivation path.
    const vaultPosition = append ? this.snapshot.wallets.length : 0;
    const derived = await deriveAccount(normalizedPhrase, 0);
    const wallet: LocalWalletMetadata = {
      id: createWalletId(),
      name: normalizeWalletName(requestedName, `${DEFAULT_WALLET_PREFIX} ${vaultPosition + 1}`),
      account: derived.account,
      createdAt: new Date().toISOString(),
    };
    const entry = await encryptMnemonic(normalizedPhrase, wallet, password);
    const stored = append ? await this.storage.read() : null;
    const vault = append
      ? normalizeStoredRecord(stored)
      : { version: LOCAL_WALLET_RECORD_VERSION, activeWalletId: wallet.id, wallets: [] } satisfies EncryptedLocalWalletVaultRecord;
    vault.wallets.push(entry);
    vault.activeWalletId = wallet.id;
    await this.storage.write(vault);

    const nextSessions = append ? new Map(this.sessions) : new Map<string, LocalWalletSession>();
    nextSessions.set(wallet.id, new LocalWalletSession(derived.account, this.client, derived.privateKey));
    derived.privateKey.fill(0);
    this.sessions.forEach((session, id) => {
      if (!nextSessions.has(id)) session.lock();
    });
    this.sessions = nextSessions;
    this.setSnapshot({ status: "unlocked", account: wallet.account, wallets: toMetadata(vault.wallets), activeWalletId: wallet.id, error: null });
    return { account: wallet.account, wallet, recoveryPhrase: normalizedPhrase };
  }

  private async refresh(): Promise<void> {
    try {
      const record = await this.storage.read();
      if (!record) {
        this.setSnapshot({ status: "absent", account: null, wallets: [], activeWalletId: null, error: null });
        return;
      }
      const vault = normalizeStoredRecord(record);
      const activeWalletId = vault.wallets.some((entry) => entry.id === vault.activeWalletId)
        ? vault.activeWalletId
        : vault.wallets[0]?.id ?? null;
      const activeEntry = activeWalletId ? findWallet(vault.wallets, activeWalletId) : null;
      this.setSnapshot({ status: "locked", account: activeEntry?.account ?? null, wallets: toMetadata(vault.wallets), activeWalletId, error: null });
    } catch (error) {
      this.setSnapshot({ status: "absent", account: null, wallets: [], activeWalletId: null, error: error instanceof Error ? error.message : "Local wallet storage is unavailable" });
    }
  }

  private setSnapshot(next: LocalWalletSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

function assertPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`Wallet password must be at least ${PASSWORD_MIN_LENGTH} characters`);
}

function isMissingAccountError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 5 || candidate.code === "not_found") return true;
  return typeof candidate.message === "string" && /account not found/i.test(candidate.message);
}

async function waitForAccount(client: Thru, address: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await client.accounts.get(address);
      return;
    } catch (error) {
      if (!isMissingAccountError(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    lastError instanceof Error
      ? "The account was submitted but is not visible on Betanet yet. Try again in a moment."
      : "The account was submitted but could not be verified on Betanet.",
  );
}

function normalizeWalletName(name: string, fallback: string): string {
  const normalized = name.trim().replace(/\s+/g, " ").slice(0, 32);
  return normalized || fallback;
}

function nextWalletName(wallets: Array<Pick<LocalWalletMetadata, "name">>): string {
  return `${DEFAULT_WALLET_PREFIX} ${wallets.length + 1}`;
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

function createWalletId(): string {
  const bytes = randomBytes(12);
  try {
    return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } finally {
    bytes.fill(0);
  }
}

async function deriveAccount(mnemonic: string, index = 0): Promise<{ account: LocalWalletAccount; privateKey: Uint8Array }> {
  const seed = MnemonicGenerator.toSeed(mnemonic);
  try {
    const derived = await ThruHDWallet.getAccount(seed, index);
    const account: LocalWalletAccount = {
      address: derived.address,
      publicKey: Pubkey.from(derived.publicKey).toThruFmt(),
      path: derived.path,
      index,
    };
    const privateKey = new Uint8Array(derived.privateKey);
    derived.privateKey.fill(0);
    derived.secretKey.fill(0);
    return { account, privateKey };
  } finally {
    seed.fill(0);
  }
}

async function encryptMnemonic(mnemonic: string, wallet: LocalWalletMetadata, password: string): Promise<EncryptedLocalWalletEntry> {
  const cryptoObject = getWebCrypto();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify({ mnemonic }));
  try {
    const ciphertext = await cryptoObject.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
    return {
      id: wallet.id,
      name: wallet.name,
      account: wallet.account,
      createdAt: wallet.createdAt,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: "AES-GCM", iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) },
    };
  } finally {
    plaintext.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

async function decryptMnemonic(entry: EncryptedLocalWalletEntry, password: string): Promise<string> {
  if (entry.kdf.name !== "PBKDF2" || entry.kdf.hash !== "SHA-256" || entry.cipher.name !== "AES-GCM") throw new Error("Unsupported local wallet record");
  const cryptoObject = getWebCrypto();
  const salt = base64ToBytes(entry.kdf.salt);
  const iv = base64ToBytes(entry.cipher.iv);
  const ciphertext = base64ToBytes(entry.cipher.ciphertext);
  const key = await deriveEncryptionKey(password, salt, entry.kdf.iterations);
  try {
    const plaintext = new Uint8Array(await cryptoObject.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext)));
    try {
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { mnemonic?: unknown };
      if (typeof parsed.mnemonic !== "string") throw new Error("Local wallet payload is invalid");
      return parsed.mnemonic;
    } finally {
      plaintext.fill(0);
    }
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

async function deriveEncryptionKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const cryptoObject = getWebCrypto();
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const baseKey = await cryptoObject.subtle.importKey("raw", toArrayBuffer(passwordBytes), "PBKDF2", false, ["deriveKey"]);
    return await cryptoObject.subtle.deriveKey({ name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: AES_KEY_LENGTH }, false, ["encrypt", "decrypt"]);
  } finally {
    passwordBytes.fill(0);
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getWebCrypto().getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isVaultRecord(record: StoredLocalWalletRecord): record is EncryptedLocalWalletVaultRecord {
  return record.version === LOCAL_WALLET_RECORD_VERSION && Array.isArray((record as EncryptedLocalWalletVaultRecord).wallets);
}

function normalizeStoredRecord(record: StoredLocalWalletRecord | null): EncryptedLocalWalletVaultRecord {
  if (!record) throw new Error("No local wallet is stored on this device");
  if (isVaultRecord(record)) return cloneRecord(record) as EncryptedLocalWalletVaultRecord;

  const legacy = record as EncryptedLocalWalletRecord;
  if (legacy.version !== LEGACY_LOCAL_WALLET_RECORD_VERSION) throw new Error("Unsupported local wallet record");
  const id = "legacy-wallet";
  return {
    version: LOCAL_WALLET_RECORD_VERSION,
    activeWalletId: id,
    wallets: [{ id, name: `${DEFAULT_WALLET_PREFIX} 1`, account: legacy.account, createdAt: legacy.createdAt, kdf: legacy.kdf, cipher: legacy.cipher }],
  };
}

function toMetadata(entries: EncryptedLocalWalletEntry[]): LocalWalletMetadata[] {
  return entries.map(({ id, name, account, createdAt }) => ({ id, name, account, createdAt }));
}

function findWallet(entries: EncryptedLocalWalletEntry[], walletId: string): EncryptedLocalWalletEntry {
  const entry = entries.find((candidate) => candidate.id === walletId);
  if (!entry) throw new Error("Local wallet account could not be found");
  return entry;
}

function cloneRecord(record: StoredLocalWalletRecord): StoredLocalWalletRecord {
  return JSON.parse(JSON.stringify(record)) as StoredLocalWalletRecord;
}
