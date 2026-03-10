import type {
  Action,
  ActionExample,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";

export const unwrapAction: Action = {
  name: "ZERC20_UNWRAP",
  description:
    "Unwrap zERC20 tokens back to standard ERC-20 tokens. Exits the privacy pool.",
  similes: ["ZERC20_WITHDRAW", "UNWRAP_PRIVATE", "EXIT_PRIVATE", "ZK_UNWRAP"],
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Unwrap 0.05 zETH on Ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll unwrap 0.05 zETH back to ETH on Ethereum. This exits the privacy pool.",
        },
      },
    ],
  ] as ActionExample[][],

  async validate(_runtime: IAgentRuntime, _message: Memory): Promise<boolean> {
    return true;
  },

  async handler(
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<boolean> {
    callback?.({
      text: "zERC20 unwrap is not yet implemented. The @zerc20/sdk integration is in progress.",
    });
    return true;
  },
};
