import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { UtolClient } from "../browser/client.js";
import { CacheStore } from "../cache/store.js";
import { ensureDataDir } from "../browser/session.js";
import { logger } from "../logger.js";
import { registerTools, type ToolDeps } from "../tools/index.js";

/**
 * ツール登録済みの McpServer を生成する。
 * stdio / HTTP 両モードから共有する。
 */
export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "utol-mcp", version: "0.1.0" });
  registerTools(server, deps);
  return server;
}

/**
 * 共有リソース（UtolClient + CacheStore）を初期化する。
 */
export async function createSharedDeps(): Promise<ToolDeps> {
  await ensureDataDir();
  return { client: new UtolClient(), cache: new CacheStore() };
}

/**
 * MCP サーバー（stdio トランスポート）を起動する。
 * stdout は JSON-RPC 専用のため、ログは stderr のみに出す。
 */
export async function startServer(): Promise<void> {
  const deps = await createSharedDeps();
  const server = createMcpServer(deps);

  const transport = new StdioServerTransport();

  const shutdown = async () => {
    logger.info("シャットダウンします。");
    await deps.client.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  logger.info("utol-mcp サーバーを起動しました（stdio）。");
}
