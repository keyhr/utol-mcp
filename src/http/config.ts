export function httpPort(): number {
  const raw = Number(process.env.UTOL_MCP_HTTP_PORT);
  return Number.isFinite(raw) ? raw : 51893;
}

export function httpHost(): string {
  return process.env.UTOL_MCP_HTTP_HOST ?? "127.0.0.1";
}

export function issuerUrl(): URL {
  const raw = process.env.UTOL_MCP_ISSUER_URL;
  if (!raw) {
    throw new Error(
      "UTOL_MCP_ISSUER_URL が未設定です。公開 HTTPS URL（例: https://utol-mcp.example.com）を指定してください。",
    );
  }
  return new URL(raw);
}
