import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { UtolClient } from "../browser/client.js";
import { CacheStore } from "../cache/store.js";
import { ensureDataDir } from "../browser/session.js";
import { logger } from "../logger.js";
import { registerTools } from "../tools/index.js";

/**
 * MCP サーバー（stdio トランスポート）を起動する。
 * stdout は JSON-RPC 専用のため、ログは stderr のみに出す。
 */
export async function startServer(): Promise<void> {
  await ensureDataDir();

  const client = new UtolClient();
  const cache = new CacheStore();

  const server = new McpServer({
    name: "utol-mcp",
    version: "0.1.0",
  });

  registerTools(server, { client, cache });

  const transport = new StdioServerTransport();

  const shutdown = async () => {
    logger.info("シャットダウンします。");
    await client.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  logger.info("utol-mcp サーバーを起動しました（stdio）。");
}
