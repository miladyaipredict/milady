import { limitlessClient } from "../client.js";

export const redeemWinningsAction = {
  name: "REDEEM_LIMITLESS_WINNINGS",
  description: "Redeem winnings from a resolved Limitless market",
  similes: ["redeem", "claim winnings", "collect payout"],

  async validate(): Promise<boolean> {
    return limitlessClient.canTrade;
  },

  async handler(
    _runtime: unknown,
    message: { content?: { conditionId?: string; text?: string } },
    _state: unknown,
    _options: unknown,
    callback: (response: { text: string }) => void,
  ): Promise<void> {
    const conditionId =
      message.content?.conditionId || message.content?.text || "";
    if (!conditionId.trim()) {
      callback({ text: "Please specify a condition ID to redeem." });
      return;
    }

    try {
      const result = await limitlessClient.redeemWinnings(conditionId.trim());
      if (result.ok) {
        callback({
          text: `Winnings redeemed for condition \`${conditionId.trim()}\`.`,
        });
      } else {
        callback({ text: `Redeem failed: ${result.error}` });
      }
    } catch (err) {
      callback({
        text: `Redeem failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
};
