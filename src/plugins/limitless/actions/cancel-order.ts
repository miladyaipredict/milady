import { limitlessClient } from "../client.js";

export const cancelOrderAction = {
  name: "CANCEL_LIMITLESS_ORDER",
  description: "Cancel an open order on Limitless",
  similes: ["cancel order", "remove order", "delete order"],

  async validate(): Promise<boolean> {
    return limitlessClient.canTrade;
  },

  async handler(
    _runtime: unknown,
    message: { content?: { orderId?: string; text?: string } },
    _state: unknown,
    _options: unknown,
    callback: (response: { text: string }) => void,
  ): Promise<void> {
    const orderId = message.content?.orderId || message.content?.text || "";
    if (!orderId.trim()) {
      callback({ text: "Please specify an order ID to cancel." });
      return;
    }

    try {
      const result = await limitlessClient.cancelOrder(orderId.trim());
      if (result.ok) {
        callback({ text: `Order \`${orderId.trim()}\` cancelled.` });
      } else {
        callback({ text: `Cancel failed: ${result.error}` });
      }
    } catch (err) {
      callback({
        text: `Cancel failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
};
