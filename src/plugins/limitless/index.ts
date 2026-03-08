import { limitlessClient } from "./client.js";
import type { LimitlessPluginConfig } from "./types.js";

import { listMarketsAction } from "./actions/list-markets.js";
import { getMarketAction } from "./actions/get-market.js";
import { placeTradeAction } from "./actions/place-trade.js";
import { checkPositionsAction } from "./actions/check-positions.js";
import { cancelOrderAction } from "./actions/cancel-order.js";
import { redeemWinningsAction } from "./actions/redeem-winnings.js";

import { limitlessContextProvider } from "./providers/limitless-context.js";
import { LimitlessWsService } from "./services/limitless-ws.js";

function resolveConfig(): LimitlessPluginConfig | null {
  const apiKey = process.env.LIMITLESS_API_KEY?.trim();
  if (!apiKey) return null;

  const privateKey =
    process.env.EVM_PRIVATE_KEY?.trim() ||
    process.env.LIMITLESS_PRIVATE_KEY?.trim() ||
    process.env.PRIVATE_KEY?.trim() ||
    "";

  return {
    apiKey,
    privateKey,
    dryRun: (process.env.LIMITLESS_DRY_RUN ?? "true").toLowerCase() !== "false",
    maxSingleTradeUsd: Number(process.env.LIMITLESS_MAX_SINGLE_TRADE_USD) || 10,
    maxTotalExposureUsd:
      Number(process.env.LIMITLESS_MAX_TOTAL_EXPOSURE_USD) || 50,
    apiUrl: process.env.LIMITLESS_API_URL || "",
  };
}

const limitlessPlugin = {
  name: "@milady/plugin-limitless",
  description: "Limitless CTF Exchange prediction market trading plugin",

  actions: [
    listMarketsAction,
    getMarketAction,
    placeTradeAction,
    checkPositionsAction,
    cancelOrderAction,
    redeemWinningsAction,
  ],

  providers: [limitlessContextProvider],

  services: [LimitlessWsService],

  async init(): Promise<void> {
    const config = resolveConfig();
    if (!config) {
      console.warn(
        "[limitless] LIMITLESS_API_KEY not set — plugin disabled.",
      );
      return;
    }
    limitlessClient.initialize(config);
  },
};

export default limitlessPlugin;
