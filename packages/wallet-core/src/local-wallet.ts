import { createThruClient, Pubkey, signMessage as signThruMessage, Signature, type Thru } from "@thru/sdk";
import { getWebCrypto, MnemonicGenerator, ThruHDWallet } from "@thru/sdk/crypto";
import type { ThruTransactionIntent } from "@thru/wallet";

const LOCAL_WALLET_DB_NAME = "cambrian-local-wallet";
const LOCAL_WALLET_STORE_NAME = "wallet";
const LOCAL_WALLET_STORAGE_KEY = "primary";
const LOCAL_WALLET_RECORD_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 310_000;
const AES_KEY_LENGTH = 256;
const PASSWORD_MIN_LENGTH = 8;

export interface LocalWalletAccount {
  address: string;
  publicKey: string;
  path: string;
  index: number;
}

export interface EncryptedLocalWalletRecord {
  version: typeof LOCAL_WALLET_RECORD_VERSION;
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

export interface LocalWalletStorage {
  read(): Promise<EncryptedLocalWalletRecord | null>;
  write(record: EncryptedLocalWalletRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface LocalWalletSnapshot {
  status: "loading" | "absent" | "locked" | "unlocked";
  account: LocalWalletAccount | null;
  error: string | null;
}

export interface LocalWalletCreationResult {
  account: LocalWalletAccount;
  /** Show this once and ask the user to write it down. It is never persisted in plaintext. */
  recoveryPhrase: string;
}

export interface LocalWalletSigner {
  readonly connected: boolean;
  readonly account: LocalWalletAccount;
  signTransaction(intent: ThruTransactionIntent): Promise<string>;
  signMessage(message: Uint8Array): Promise<string>;
  lock(): void;
}

/**
 * Browser-backed storage for the encrypted wallet envelope.
 * IndexedDB is intentionally used instead of localStorage: the stored value
 * contains only public account metadata and AES-GCM ciphertext.
 */
export class IndexedDbLocalWalletStorage implements LocalWalletStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async read(): Promise<EncryptedLocalWalletRecord | null> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction(LOCAL_WALLET_STORE_NAME, "readonly")
        .objectStore(LOCAL_WALLET_STORE_NAME)
        .get(LOCAL_WALLET_STORAGE_KEY);
      request.onsuccess = () => resolve((request.result as EncryptedLocalWalletRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Local wallet storage could not be read"));
    });
  }

  async write(record: EncryptedLocalWalletRecord): Promise<void> {
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
  private record: EncryptedLocalWalletRecord | null = null;

  async read(): Promise<EncryptedLocalWalletRecord | null> {
    return this.record ? cloneRecord(this.record) : null;
  }

  async write(record: EncryptedLocalWalletRecord): Promise<void> {
    this.record = cloneRecord(record);
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}

/**
 * A local, self-custodial signing session. The private key exists only while
 * this object is unlocked and is cleared when lock() is called.
 */
export class LocalWalletSession implements LocalWalletSigner {
  private privateKey: Uint8Array | null;
  readonly account: LocalWalletAccount;
  private readonly client: Thru;

  constructor(
    account: LocalWalletAccount,
    client: Thru,
    privateKey: Uint8Array,
  ) {
    this.account = account;
    this.client = client;
    this.privateKey = new Uint8Array(privateKey);
  }

  get connected(): boolean {
    return this.privateKey !== null;
  }

  async signTransaction(intent: ThruTransactionIntent): Promise<string> {
    const privateKey = this.requirePrivateKey();
    if (intent.walletAddress && intent.walletAddress !== this.account.address) {
      throw new Error("Transaction wallet address does not match the selected local account");
    }

    const signed = await this.client.transactions.buildAndSign({
      feePayer: {
        publicKey: this.account.address,
        privateKey,
      },
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
 * Owns the encrypted local-wallet envelope and exposes a small observable
 * state surface for the Cambrian UI. It never exposes the mnemonic from its
 * snapshot; create() returns it once so the UI can show a backup step.
 */
export class LocalWalletController {
  private readonly storage: LocalWalletStorage;
  private readonly client: Thru;
  private readonly listeners = new Set<() => void>();
  private session: LocalWalletSession | null = null;
  private snapshot: LocalWalletSnapshot = { status: "loading", account: null, error: null };
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
    return this.session?.connected ? this.session : null;
  }

  async create(password: string): Promise<LocalWalletCreationResult> {
    await this.ready;
    assertPassword(password);
    if (this.snapshot.account) {
      throw new Error("A local wallet already exists. Unlock it or reset it before creating another wallet.");
    }

    const recoveryPhrase = MnemonicGenerator.generate();
    const derived = await deriveAccount(recoveryPhrase);
    await this.persist(recoveryPhrase, derived.account, password);
    this.replaceSession(derived.account, derived.privateKey);
    return { account: derived.account, recoveryPhrase };
  }

  async restore(recoveryPhrase: string, password: string): Promise<LocalWalletAccount> {
    await this.ready;
    assertPassword(password);
    if (this.snapshot.account) {
      throw new Error("A local wallet already exists. Unlock it or reset it before restoring another wallet.");
    }

    const normalizedPhrase = normalizePhrase(recoveryPhrase);
    if (!MnemonicGenerator.validate(normalizedPhrase)) {
      throw new Error("Recovery phrase is not a valid Thru BIP39 phrase");
    }

    const derived = await deriveAccount(normalizedPhrase);
    await this.persist(normalizedPhrase, derived.account, password);
    this.replaceSession(derived.account, derived.privateKey);
    return derived.account;
  }

  async unlock(password: string): Promise<LocalWalletAccount> {
    await this.ready;
    assertPassword(password);
    const record = await this.storage.read();
    if (!record) throw new Error("No local wallet is stored on this device");

    let mnemonic: string;
    try {
      mnemonic = await decryptMnemonic(record, password);
    } catch {
      throw new Error("Invalid wallet password or corrupted local wallet");
    }

    const derived = await deriveAccount(mnemonic);
    if (derived.account.address !== record.account.address) {
      derived.privateKey.fill(0);
      throw new Error("Local wallet metadata does not match its encrypted account");
    }

    this.replaceSession(derived.account, derived.privateKey);
    return derived.account;
  }

  lock(): void {
    this.session?.lock();
    this.session = null;
    if (this.snapshot.account) {
      this.setSnapshot({ status: "locked", account: this.snapshot.account, error: null });
    }
  }

  async clear(): Promise<void> {
    await this.ready;
    this.lock();
    await this.storage.clear();
    this.setSnapshot({ status: "absent", account: null, error: null });
  }

  private async refresh(): Promise<void> {
    try {
      const record = await this.storage.read();
      this.setSnapshot(record ? { status: "locked", account: record.account, error: null } : { status: "absent", account: null, error: null });
    } catch (error) {
      this.setSnapshot({
        status: "absent",
        account: null,
        error: error instanceof Error ? error.message : "Local wallet storage is unavailable",
      });
    }
  }

  private async persist(mnemonic: string, account: LocalWalletAccount, password: string): Promise<void> {
    const record = await encryptMnemonic(mnemonic, account, password);
    await this.storage.write(record);
  }

  private replaceSession(account: LocalWalletAccount, privateKey: Uint8Array): void {
    this.session?.lock();
    this.session = new LocalWalletSession(account, this.client, privateKey);
    privateKey.fill(0);
    this.setSnapshot({ status: "unlocked", account, error: null });
  }

  private setSnapshot(next: LocalWalletSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

function assertPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Wallet password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

async function deriveAccount(mnemonic: string): Promise<{ account: LocalWalletAccount; privateKey: Uint8Array }> {
  const seed = MnemonicGenerator.toSeed(mnemonic);
  try {
    const derived = await ThruHDWallet.getAccount(seed, 0);
    const account: LocalWalletAccount = {
      address: derived.address,
      publicKey: Pubkey.from(derived.publicKey).toThruFmt(),
      path: derived.path,
      index: 0,
    };
    const privateKey = new Uint8Array(derived.privateKey);
    derived.privateKey.fill(0);
    derived.secretKey.fill(0);
    return { account, privateKey };
  } finally {
    seed.fill(0);
  }
}

async function encryptMnemonic(mnemonic: string, account: LocalWalletAccount, password: string): Promise<EncryptedLocalWalletRecord> {
  const cryptoObject = getWebCrypto();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify({ mnemonic }));
  try {
    const ciphertext = await cryptoObject.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
    return {
      version: LOCAL_WALLET_RECORD_VERSION,
      account,
      createdAt: new Date().toISOString(),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: "AES-GCM", iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) },
    };
  } finally {
    plaintext.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

async function decryptMnemonic(record: EncryptedLocalWalletRecord, password: string): Promise<string> {
  if (record.version !== LOCAL_WALLET_RECORD_VERSION || record.kdf.name !== "PBKDF2" || record.kdf.hash !== "SHA-256" || record.cipher.name !== "AES-GCM") {
    throw new Error("Unsupported local wallet record");
  }
  const cryptoObject = getWebCrypto();
  const salt = base64ToBytes(record.kdf.salt);
  const iv = base64ToBytes(record.cipher.iv);
  const ciphertext = base64ToBytes(record.cipher.ciphertext);
  const key = await deriveEncryptionKey(password, salt, record.kdf.iterations);
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
    return await cryptoObject.subtle.deriveKey(
      { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      false,
      ["encrypt", "decrypt"],
    );
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
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
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

function cloneRecord(record: EncryptedLocalWalletRecord): EncryptedLocalWalletRecord {
  return JSON.parse(JSON.stringify(record)) as EncryptedLocalWalletRecord;
}
