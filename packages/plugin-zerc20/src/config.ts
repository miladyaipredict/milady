import type { Zerc20Config } from "./types.js";

const DEFAULT_INDEXER_URL = "https://indexer.zerc20.io";
const DEFAULT_DECIDER_URL = "https://prover.zerc20.io";

/**
 * Load zERC20 configuration from environment variables.
 * Falls back to sensible defaults for indexer and prover URLs.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env as any): Zerc20Config {
  return {
    privateKey: env.ZERC20_PRIVATE_KEY ?? env.EVM_PRIVATE_KEY,
    seedHex: env.ZERC20_SEED_HEX,
    indexerUrl: env.ZERC20_INDEXER_URL ?? DEFAULT_INDEXER_URL,
    deciderUrl: env.ZERC20_DECIDER_URL ?? DEFAULT_DECIDER_URL,
  };
}
