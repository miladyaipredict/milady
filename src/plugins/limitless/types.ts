export interface LimitlessPluginConfig {
  apiKey: string;
  privateKey: string;
  dryRun: boolean;
  maxSingleTradeUsd: number;
  maxTotalExposureUsd: number;
  apiUrl: string;
}

export interface LimitlessMarket {
  id: string;
  title: string;
  conditionId: string;
  /** positionIds[0] = YES, positionIds[1] = NO. Always. */
  positionIds: [string, string];
  volumeUsd: number;
  endDate: string | null;
  status: "active" | "resolved" | "paused";
  prices: { yes: number; no: number };
}

export interface LimitlessPosition {
  marketId: string;
  marketTitle: string;
  outcome: "yes" | "no";
  shares: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  costBasis: number;
}

export interface LimitlessOrder {
  orderId: string;
  marketId: string;
  conditionId: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  price: number;
  amount: number;
  status: "open" | "filled" | "cancelled";
  createdAt: string;
}

export interface LimitlessOrderbook {
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
}

export interface ExposureSnapshot {
  totalExposureUsd: number;
  positionCount: number;
  remainingBudgetUsd: number;
  maxSingleTradeUsd: number;
  maxTotalExposureUsd: number;
}
