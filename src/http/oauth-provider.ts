import { timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { OAuthStore } from "./oauth-store.js";
import { renderConsentPage } from "./consent-page.js";
import { logger } from "../logger.js";

const ACCESS_TOKEN_TTL = 3600;       // 1 hour
const REFRESH_TOKEN_TTL = 30 * 86400; // 30 days

const PASSPHRASE_RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = PASSPHRASE_RATE_LIMIT.get(ip);
  if (!entry || now > entry.resetAt) {
    PASSPHRASE_RATE_LIMIT.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_ATTEMPTS;
}

function verifyPassphrase(input: string): boolean {
  const raw = process.env.UTOL_MCP_AUTH_PASSPHRASE;
  if (!raw) {
    logger.warn("UTOL_MCP_AUTH_PASSPHRASE が未設定です。authorize は全て拒否されます。");
    return false;
  }
  const a = Buffer.from(input);
  const b = Buffer.from(raw);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

class UtolClientsStore implements OAuthRegisteredClientsStore {
  constructor(private store: OAuthStore) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.store.getClient(clientId);
  }

  async registerClient(
    metadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    return this.store.registerClient(metadata);
  }
}

export class UtolOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: UtolClientsStore;

  constructor(private store: OAuthStore) {
    this.clientsStore = new UtolClientsStore(store);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const req = res.req;
    const passphrase = req.body?.passphrase as string | undefined;

    const hiddenFields: Record<string, string> = {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      response_type: "code",
    };
    if (params.state) hiddenFields.state = params.state;
    if (params.scopes?.length) hiddenFields.scope = params.scopes.join(" ");
    if (params.resource) hiddenFields.resource = params.resource.toString();

    if (!passphrase) {
      res.status(200).type("html").send(renderConsentPage({
        clientName: client.client_name ?? client.client_id,
        scopes: params.scopes ?? [],
        hiddenFields,
      }));
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
      logger.warn("authorize: レート制限超過", { ip });
      res.status(429).type("html").send(renderConsentPage({
        clientName: client.client_name ?? client.client_id,
        scopes: params.scopes ?? [],
        error: "試行回数が上限を超えました。しばらく待ってから再試行してください。",
        hiddenFields,
      }));
      return;
    }

    if (!verifyPassphrase(passphrase)) {
      logger.warn("authorize: パスフレーズ不一致", { ip });
      res.status(403).type("html").send(renderConsentPage({
        clientName: client.client_name ?? client.client_id,
        scopes: params.scopes ?? [],
        error: "パスフレーズが正しくありません。",
        hiddenFields,
      }));
      return;
    }

    logger.info("authorize: 承認されました", { clientId: client.client_id, ip });

    const code = await this.store.createCode({
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes ?? [],
      resource: params.resource?.toString(),
    });

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);

    res.redirect(302, target.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const entry = this.store.getCode(authorizationCode);
    if (!entry) throw new Error("invalid or expired authorization code");
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const entry = await this.store.consumeCode(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error("invalid or expired authorization code");
    }

    const accessToken = await this.store.createToken(
      "access", client.client_id, entry.scopes, ACCESS_TOKEN_TTL,
    );
    const refreshToken = await this.store.createToken(
      "refresh", client.client_id, entry.scopes, REFRESH_TOKEN_TTL,
    );

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const entry = this.store.getToken(refreshToken);
    if (!entry || entry.type !== "refresh" || entry.clientId !== client.client_id) {
      throw new Error("invalid refresh token");
    }
    await this.store.deleteToken(refreshToken);

    const finalScopes = scopes ?? entry.scopes;
    const newAccess = await this.store.createToken(
      "access", client.client_id, finalScopes, ACCESS_TOKEN_TTL,
    );
    const newRefresh = await this.store.createToken(
      "refresh", client.client_id, finalScopes, REFRESH_TOKEN_TTL,
    );

    return {
      access_token: newAccess,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: newRefresh,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const entry = this.store.getToken(token);
    if (!entry || entry.type !== "access") {
      throw new Error("invalid or expired access token");
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: entry.scopes,
      expiresAt: entry.expiresAt,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.store.deleteToken(request.token);
  }
}
