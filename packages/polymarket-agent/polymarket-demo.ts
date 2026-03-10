/**
 * elizaOS Polymarket Trading Agent Demo
 *
 * Entry point for the AI-powered Polymarket trading agent.
 * This demo showcases elizaOS capabilities:
 * - AgentRuntime with plugins (SQL, LLM provider, EVM, Polymarket)
 * - Interactive TUI chat/operator flow
 * - Polymarket auth + account verification
 *
 * Usage:
 *   OPENAI_API_KEY=key EVM_PRIVATE_KEY=key bun run polymarket-demo.ts chat
 *
 * For interactive setup:
 *   bun run polymarket-demo.ts settings
 */

// Suppress verbose logging
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { parseArgs } from "./lib";
import { chat, inputTest, settings, verify } from "./runner";

type Command = "help" | "verify" | "chat" | "settings" | "input-test";

function usage(): void {
  const text = [
    "elizaOS Polymarket Trading Agent",
    "",
    "An AI agent that analyzes prediction markets and makes trading decisions.",
    "",
    "Commands:",
    "  chat                   Start a chat session (default)",
    "  settings               Configure .env interactively",
    "  verify                 Validate config and wallet derivation",
    "  input-test             Run Ink input/scroll test",
    "",
    "Required Environment:",
    "  One LLM provider key   OPENAI_API_KEY | ANTHROPIC_API_KEY | GOOGLE_GENERATIVE_AI_API_KEY",
    "                         GROQ_API_KEY | XAI_API_KEY",
    "  EVM_PRIVATE_KEY        Wallet for Polymarket (or POLYMARKET_PRIVATE_KEY)",
    "",
    "Optional Environment:",
    "  CLOB_API_URL           CLOB API URL (default: https://clob.polymarket.com)",
    "  CLOB_API_KEY           Optional; verify/chat can derive creds from wallet",
    "  CLOB_API_SECRET        Optional",
    "  CLOB_API_PASSPHRASE    Optional",
    "  PGLITE_DATA_DIR        Persistent database path (default: memory://)",
    "",
    "Flags:",
    "  --execute              Place real orders (requires CLOB credentials)",
    "  --order-size <n>       Order size in shares (default 1)",
    "  --max-pages <n>        Pages to scan for active markets (default 1)",
    "  --chain <name>         EVM chain name (default polygon)",
    "  --rpc-url <url>        Custom RPC URL for the chain",
    "  --private-key <hex>    Private key (overrides env vars)",
    "  --clob-api-url <url>   CLOB API URL (overrides env var)",
    "",
    "Examples:",
    "  # Interactive setup wizard",
    "  bun run polymarket-demo.ts settings",
    "",
    "  # Validate wallet and Polymarket connectivity",
    "  bun run polymarket-demo.ts verify",
    "",
    "  # Interactive chat (with /autonomy true|false)",
    "  bun run polymarket-demo.ts chat",
  ].join("\n");
  console.log(text);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command as Command) {
    case "help":
      usage();
      break;
    case "chat":
      await chat(options);
      break;
    case "settings":
      await settings(options);
      break;
    case "verify":
      await verify(options);
      break;
    case "input-test":
      await inputTest(options);
      break;
    default:
      usage();
  }
}

if (import.meta.main) {
  main()
    .then(() => {
      // Force exit after non-interactive commands — background workers
      // (PGLite, polymarket websocket timers) can keep the process alive.
      process.exit(0);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      // Reset terminal state in case TUI was active
      if (process.stdout.isTTY) {
        process.stdout.write(
          "\x1b[?1000l\x1b[?1006l\x1b[?1015l\x1b[?1007l\n",
        );
      }

      console.error("\n" + "=".repeat(60));
      console.error("❌ FATAL ERROR");
      console.error("=".repeat(60));
      console.error(message);
      if (stack) {
        console.error("\nStack trace:");
        console.error(stack);
      }
      console.error("=".repeat(60));
      console.error("Check polymarket-error.log for more details");
      console.error("");
      process.exit(1);
    });
}
