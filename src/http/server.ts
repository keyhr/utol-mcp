import { randomUUID } from "node:crypto";
import express from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer, createSharedDeps } from "../mcp/server.js";
import type { ToolDeps } from "../tools/index.js";
import { OAuthStore } from "./oauth-store.js";
import { UtolOAuthProvider } from "./oauth-provider.js";
import { MaterialStore, UrlFileSink } from "./material-store.js";
import { httpPort, httpHost, issuerUrl } from "./config.js";
import { logger } from "../logger.js";

const MCP_PATH = "/mcp";

export async function startHttpServer(opts?: {
  port?: number;
  host?: string;
}): Promise<void> {
  const port = opts?.port ?? httpPort();
  const host = opts?.host ?? httpHost();
  const issuer = issuerUrl();

  const store = new OAuthStore();
  await store.load();
  const provider = new UtolOAuthProvider(store);

  const materialStore = new MaterialStore();
  const deps = await createSharedDeps(new UrlFileSink(materialStore, issuer));

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  const app = express();

  const resourceServerUrl = new URL(MCP_PATH, issuer);

  // 教材ダウンロード用のケイパビリティ URL（推測不能トークン・短TTL・単回使用）。
  // MCP のコンテキストを経由せずに生ファイルをクライアントへ渡すための経路。
  app.get("/dl/:token", (req, res) => {
    const entry = materialStore.take(req.params.token);
    if (!entry) {
      res.status(404).json({ error: "リンクが無効か、期限切れか、既に使用済みです。" });
      return;
    }
    res.setHeader("Content-Type", entry.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
    );
    res.setHeader("Content-Length", String(entry.buffer.byteLength));
    res.end(entry.buffer);
  });

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: issuer,
    baseUrl: issuer,
    resourceServerUrl,
  }) as express.RequestHandler);

  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: new URL(
      `/.well-known/oauth-protected-resource${MCP_PATH}`,
      issuer,
    ).href,
  });

  app.post(MCP_PATH, bearerAuth as express.RequestHandler, async (req, res) => {
    await handleMcpRequest(req, res, deps, sessions);
  });

  app.get(MCP_PATH, bearerAuth as express.RequestHandler, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      res.status(400).json({ error: "invalid or missing session" });
      return;
    }
    await entry.transport.handleRequest(req, res);
  });

  app.delete(MCP_PATH, bearerAuth as express.RequestHandler, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      res.status(400).json({ error: "invalid or missing session" });
      return;
    }
    await entry.transport.handleRequest(req, res);
  });

  const httpServer = app.listen(port, host, () => {
    logger.info(`utol-mcp HTTP サーバーを起動しました: http://${host}:${port}`);
    logger.info(`MCP エンドポイント: ${new URL(MCP_PATH, issuer)}`);
  });

  const shutdown = async () => {
    logger.info("シャットダウンします。");
    for (const [, entry] of sessions) {
      await entry.transport.close().catch(() => {});
    }
    await deps.client.close().catch(() => {});
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handleMcpRequest(
  req: express.Request,
  res: express.Response,
  deps: ToolDeps,
  sessions: Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createMcpServer(deps);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  await server.connect(transport);

  await transport.handleRequest(req, res);

  const sid = transport.sessionId;
  if (sid) {
    sessions.set(sid, { transport, server });
  }
}
