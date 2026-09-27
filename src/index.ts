#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { TokenManager } from "./auth.js";
import { CherwellClient } from "./client.js";
import { CherwellApi } from "./api.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // stdout is the MCP protocol channel — all diagnostics must go to stderr.
  const config = loadConfig();

  const server = new McpServer({ name: "cherwell-mcp", version: "0.1.0" });
  const api = new CherwellApi(new CherwellClient(config, new TokenManager(config)));
  registerTools(server, api);

  await server.connect(new StdioServerTransport());
  console.error(`cherwell-mcp: connected via stdio (Cherwell host: ${config.baseUrl})`);
}

main().catch((error: unknown) => {
  console.error(`cherwell-mcp failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
