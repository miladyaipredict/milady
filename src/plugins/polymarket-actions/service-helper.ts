/**
 * Helper to access the PolymarketService from the runtime.
 *
 * All actions in this extension use the service from @elizaos/plugin-polymarket
 * rather than creating their own client.
 */
import type { IAgentRuntime } from "@elizaos/core";

const POLYMARKET_SERVICE_NAME = "polymarket";
const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const GAMMA_FETCH_TIMEOUT_MS = 8000;

export const POLYMARKET_PROVIDER_CACHE_KEY = "polymarket:provider";

/**
 * Loosely-typed service interface — only the methods our actions need.
 * Avoids importing the concrete class from @elizaos/plugin-polymarket.
 */
export interface PolymarketServiceLike {
  getAuthenticatedClient(): ClobClientLike;
  getClobClient(): ClobClientLike;
  getCachedAccountState(): AccountStateLike | null;
  getAccountState(): Promise<AccountStateLike | null>;
  getAuthenticationStatus(): AuthStatusLike;
  invalidateAccountState?(): void;
  updateConditionalBalances?(assetIds: string[]): Promise<void>;
}

export interface ClobClientLike {
  getOpenOrders(
    params?: { market?: string; asset_id?: string },
    onlyFirstPage?: boolean,
  ): Promise<OpenOrderLike[]>;
  cancelOrder(payload: { orderID: string }): Promise<unknown>;
  cancelOrders(hashes: string[]): Promise<unknown>;
  cancelAll(): Promise<unknown>;
  cancelMarketOrders(params: {
    market?: string;
    asset_id?: string;
  }): Promise<unknown>;
  getBalanceAllowance(params: {
    asset_type: string;
    token_id?: string;
  }): Promise<{ balance: string; allowance: string }>;
  updateBalanceAllowance(params?: {
    asset_type: string;
    token_id?: string;
  }): Promise<void>;
  getPricesHistory(params: {
    market?: string;
    startTs?: number;
    endTs?: number;
    fidelity?: number;
    interval?: string;
  }): Promise<Array<{ t: number; p: number }>>;
}

export interface OpenOrderLike {
  id: string;
  status: string;
  market: string;
  asset_id: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
  outcome: string;
  created_at: number;
  order_type: string;
}

export interface AccountStateLike {
  walletAddress: string;
  balances: {
    collateral: { balance: string; allowance: string } | null;
    conditionalTokens: Record<string, { balance: string }>;
  };
  activeOrders: OpenOrderLike[];
  recentTrades: Array<{
    asset_id: string;
    side: string;
    size: string;
    price: string;
    outcome: string;
    market: string;
  }>;
  positions: Array<{
    asset_id: string;
    market: string;
    size: string;
    average_price: string;
    realized_pnl: string;
    unrealized_pnl: string;
  }>;
  orderScoringStatus: Record<string, boolean>;
  lastUpdatedAt: number;
}

export interface AuthStatusLike {
  canTrade: boolean;
  canReadMarkets: boolean;
  walletAddress?: string;
}

export interface GammaMarket {
  condition_id?: string;
  conditionId?: string;
  question?: string;
  description?: string;
  end_date_iso?: string;
  resolution_source?: string;
  specific_rules?: string;
  tokens?: Array<{ token_id: string; outcome: string; price: number }>;
  market_slug?: string;
}

export function getService(
  runtime: IAgentRuntime,
): PolymarketServiceLike | null {
  return runtime.getService(
    POLYMARKET_SERVICE_NAME,
  ) as unknown as PolymarketServiceLike | null;
}

export function getServiceOrThrow(
  runtime: IAgentRuntime,
): PolymarketServiceLike {
  const svc = getService(runtime);
  if (!svc) {
    throw new Error(
      "PolymarketService not available — ensure @elizaos/plugin-polymarket is loaded",
    );
  }
  return svc;
}

export function hasService(runtime: IAgentRuntime): boolean {
  return getService(runtime) !== null;
}

export function canTrade(runtime: IAgentRuntime): boolean {
  const svc = getService(runtime);
  if (!svc) return false;
  try {
    return svc.getAuthenticationStatus().canTrade;
  } catch {
    return false;
  }
}

export async function invalidateCache(runtime: IAgentRuntime): Promise<void> {
  try {
    await runtime.deleteCache?.(POLYMARKET_PROVIDER_CACHE_KEY);
    const svc = getService(runtime);
    svc?.invalidateAccountState?.();
  } catch {
    // best-effort
  }
}

export async function fetchGammaMarket(
  conditionId: string,
): Promise<GammaMarket | null> {
  const url = `${GAMMA_API_URL}/markets?condition_id=${encodeURIComponent(conditionId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(GAMMA_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = (await res.json()) as GammaMarket[];
  // Gamma API returns 20 random markets for unrecognized condition_ids.
  // Validate that the returned market actually matches our query.
  const match = data.find(
    (m) =>
      (m.condition_id ?? m.conditionId ?? "").toLowerCase() ===
      conditionId.toLowerCase(),
  );
  return match ?? null;
}

export async function fetchGammaMarketBySlug(
  slug: string,
): Promise<GammaMarket | null> {
  const url = `${GAMMA_API_URL}/markets?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(GAMMA_FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = (await res.json()) as GammaMarket[];
  return data[0] ?? null;
}

/** Resolve a condition_id or market slug to a market question string. */
export async function resolveMarketName(
  conditionIdOrMarket: string,
): Promise<string | null> {
  try {
    const market = await fetchGammaMarket(conditionIdOrMarket);
    return market?.question ?? null;
  } catch {
    return null;
  }
}
