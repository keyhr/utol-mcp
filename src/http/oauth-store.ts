import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { dataDir } from "../config.js";

const OAUTH_DIR = () => join(dataDir(), "oauth");
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface StoredCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  createdAt: number;
}

export interface StoredToken {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  type: "access" | "refresh";
}

type ClientsMap = Record<string, OAuthClientInformationFull>;
type CodesMap = Record<string, StoredCode>;
type TokensMap = Record<string, StoredToken>;

async function ensureDir(): Promise<string> {
  const dir = OAUTH_DIR();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function saveJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
}

export class OAuthStore {
  private clients: ClientsMap = {};
  private codes: CodesMap = {};
  private tokens: TokensMap = {};
  private dir = "";

  async load(): Promise<void> {
    this.dir = await ensureDir();
    this.clients = await loadJson(join(this.dir, "clients.json"), {});
    this.codes = await loadJson(join(this.dir, "codes.json"), {});
    this.tokens = await loadJson(join(this.dir, "tokens.json"), {});
    this.purgeExpiredCodes();
    this.purgeExpiredTokens();
  }

  // --- Clients ---

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients[clientId];
  }

  async registerClient(
    metadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const client: OAuthClientInformationFull = {
      ...metadata,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients[client.client_id] = client;
    await this.saveClients();
    return client;
  }

  // --- Authorization Codes ---

  async createCode(entry: Omit<StoredCode, "createdAt">): Promise<string> {
    this.purgeExpiredCodes();
    const code = randomBytes(32).toString("hex");
    this.codes[code] = { ...entry, createdAt: Date.now() };
    await this.saveCodes();
    return code;
  }

  getCode(code: string): StoredCode | undefined {
    const entry = this.codes[code];
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > CODE_TTL_MS) {
      delete this.codes[code];
      return undefined;
    }
    return entry;
  }

  async consumeCode(code: string): Promise<StoredCode | undefined> {
    const entry = this.getCode(code);
    if (!entry) return undefined;
    delete this.codes[code];
    await this.saveCodes();
    return entry;
  }

  // --- Tokens ---

  async createToken(
    type: "access" | "refresh",
    clientId: string,
    scopes: string[],
    ttlSeconds: number,
  ): Promise<string> {
    const token = randomBytes(48).toString("hex");
    this.tokens[token] = {
      clientId,
      scopes,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
      type,
    };
    await this.saveTokens();
    return token;
  }

  getToken(token: string): StoredToken | undefined {
    const entry = this.tokens[token];
    if (!entry) return undefined;
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      delete this.tokens[token];
      return undefined;
    }
    return entry;
  }

  async deleteToken(token: string): Promise<void> {
    delete this.tokens[token];
    await this.saveTokens();
  }

  // --- Persistence helpers ---

  private purgeExpiredCodes(): void {
    const now = Date.now();
    for (const [k, v] of Object.entries(this.codes)) {
      if (now - v.createdAt > CODE_TTL_MS) delete this.codes[k];
    }
  }

  private purgeExpiredTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, v] of Object.entries(this.tokens)) {
      if (v.expiresAt < now) delete this.tokens[k];
    }
  }

  private async saveClients(): Promise<void> {
    await saveJson(join(this.dir, "clients.json"), this.clients);
  }

  private async saveCodes(): Promise<void> {
    await saveJson(join(this.dir, "codes.json"), this.codes);
  }

  private async saveTokens(): Promise<void> {
    await saveJson(join(this.dir, "tokens.json"), this.tokens);
  }
}
