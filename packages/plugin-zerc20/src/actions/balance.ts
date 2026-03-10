import type {
  Action,
  ActionExample,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { Zerc20Service } from "../service.js";
import { loadConfig } from "../config.js";
import { ALL_DEPLOYMENTS } from "../registry.js";
import type { Address } from "viem";

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  56: "BNB Chain",
  8453: "Base",
  42161: "Arbitrum",
};

export const balanceAction: Action = {
  name: "ZERC20_BALANCE",
  description:
    "Check zERC20 private token balances across all supported chains (Ethereum, BNB, Base, Arbitrum). Shows zETH, zBNB, and zUSDC balances.",
  similes: [
    "ZERC20_CHECK_BALANCE",
    "ZERC20_GET_BALANCE",
    "PRIVATE_BALANCE",
    "ZK_BALANCE",
    "ZERC20_BALANCES",
  ],
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What's my zERC20 balance?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check your zERC20 private token balances across all chains.",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Show my private token balances" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking your zERC20 balances on Ethereum, BNB Chain, Base, and Arbitrum...",
        },
      },
    ],
  ] as ActionExample[][],

  async validate(_runtime: IAgentRuntime, _message: Memory): Promise<boolean> {
    return true;
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<boolean> {
    const config = loadConfig(runtime.getSetting ? (runtime as any) : undefined);
    const service = new Zerc20Service(config);

    // Get wallet address from runtime
    const walletAddress = runtime.getSetting?.("EVM_ADDRESS") as Address | undefined;
    if (!walletAddress) {
      callback?.({
        text: "No EVM wallet address configured. Set EVM_ADDRESS or EVM_PRIVATE_KEY to check zERC20 balances.",
      });
      return false;
    }

    try {
      const balances = await service.getBalances(walletAddress);

      if (balances.length === 0) {
        callback?.({
          text: `No zERC20 balances found for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}.\n\nSupported tokens: zETH, zBNB, zUSDC\nSupported chains: Ethereum, BNB Chain, Base, Arbitrum\n\nUse "wrap" to convert ERC-20 tokens to their private zERC20 equivalents.`,
        });
        return true;
      }

      const lines = balances.map(
        (b) =>
          `  ${b.symbol} on ${CHAIN_LABELS[b.chainId] ?? `Chain ${b.chainId}`}: ${b.formatted}`,
      );

      callback?.({
        text: `zERC20 Balances for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}:\n\n${lines.join("\n")}`,
      });

      return true;
    } catch (err) {
      callback?.({
        text: `Failed to fetch zERC20 balances: ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    }
  },
};
