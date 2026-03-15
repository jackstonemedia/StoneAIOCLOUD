import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { containerService } from "./containerService.js";
import { chatService } from "./chatService.js";
import crypto from "crypto";
import { logger } from "../lib/logger.js";

class McpService {
  private servers: Map<string, McpServer> = new Map();

  async getOrCreateServer(apiKey: string) {
    if (this.servers.has(apiKey)) {
      return this.servers.get(apiKey)!;
    }

    const db = getDb();
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const keyRecord = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash) as any;

    if (!keyRecord) {
      throw new Error('Invalid API Key');
    }

    const userId = keyRecord.user_id;

    const server = new McpServer({
      name: "stone-aio",
      version: "1.0.0",
    });

    // Register Tools
    server.tool(
      "exec_command",
      {
        command: z.string().describe("Shell command to run"),
        workdir: z.string().optional().describe("Working directory"),
        timeout: z.number().optional().describe("Timeout in ms")
      },
      async ({ command, workdir, timeout }) => {
        const result = await containerService.execInContainer(userId, command, { workdir, timeout });
        return {
          content: [{ type: "text", text: result.stdout || result.stderr || "Command completed with no output" }],
          isError: result.exitCode !== 0
        };
      }
    );

    server.tool(
      "read_file",
      { path: z.string().describe("Path to the file to read") },
      async ({ path }) => {
        const content = await containerService.readFile(userId, path);
        return { content: [{ type: "text", text: content }] };
      }
    );

    server.tool(
      "write_file",
      {
        path: z.string().describe("Path to the file to write"),
        content: z.string().describe("Content to write to the file")
      },
      async ({ path, content }) => {
        await containerService.writeFile(userId, path, content);
        return { content: [{ type: "text", text: `Successfully wrote to ${path}` }] };
      }
    );

    server.tool(
      "list_directory",
      { path: z.string().describe("Path to the directory to list") },
      async ({ path }) => {
        const result = await containerService.listDirectory(userId, path);
        return { content: [{ type: "text", text: result }] };
      }
    );

    server.tool(
      "get_container_stats",
      {},
      async () => {
        const stats = await containerService.getStats(userId);
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }
    );

    this.servers.set(apiKey, server);
    return server;
  }
}

export const mcpService = new McpService();
