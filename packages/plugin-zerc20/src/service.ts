import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, bsc, base, arbitrum } from "viem/chains";
import type { Zerc20Balance, Zerc20ChainId, Zerc20Config } from "./types.js";
import { ALL_DEPLOYMENTS, findDeployment } from "./registry.js";

const CHAIN_MAP = {
  1: mainnet,
  56: bsc,
  8453: base,
  42161: arbitrum,
} as const;

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/**
 * Zerc20Service — wraps on-chain reads for zERC20 token balances.
 *
 * Phase 1: balance queries only.
 * Phase 2 will add wrap/unwrap/privateSend/receive via @zerc20/sdk.
 */
export class Zerc20Service {
  private config: Zerc20Config;
  private clients = new Map<Zerc20ChainId, PublicClient>();

  constructor(config: Zerc20Config) {
    this.config = config;
  }

  private getPublicClient(chainId: Zerc20ChainId): PublicClient {
    let client = this.clients.get(chainId);
    if (client) return client;

    const chain = CHAIN_MAP[chainId];
    const deployment = Object.values(ALL_DEPLOYMENTS)
      .flat()
      .find((d) => d.chainId === chainId);

    client = createPublicClient({
      chain,
      transport: http(deployment?.rpcUrls[0]),
    }) as PublicClient;

    this.clients.set(chainId, client);
    return client;
  }

  /**
   * Query all zERC20 balances for the configured wallet across all chains.
   */
  async getBalances(walletAddress: Address): Promise<Zerc20Balance[]> {
    const results: Zerc20Balance[] = [];

    for (const [symbol, deployments] of Object.entries(ALL_DEPLOYMENTS)) {
      for (const deployment of deployments) {
        try {
          const client = this.getPublicClient(deployment.chainId);
          const balance = await client.readContract({
            address: deployment.tokenAddress,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [walletAddress],
          });

          if ((balance as bigint) > 0n) {
            results.push({
              chainId: deployment.chainId,
              symbol,
              balance: balance as bigint,
              formatted: formatEther(balance as bigint),
            });
          }
        } catch {
          // Chain RPC may be unreachable; skip silently
        }
      }
    }

    return results;
  }

  /**
   * Query zERC20 balance for a specific token on a specific chain.
   */
  async getBalance(
    walletAddress: Address,
    symbol: keyof typeof ALL_DEPLOYMENTS,
    chainId: Zerc20ChainId,
  ): Promise<bigint> {
    const deployment = findDeployment(symbol, chainId);
    if (!deployment) return 0n;

    const client = this.getPublicClient(chainId);
    try {
      const balance = await client.readContract({
        address: deployment.tokenAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      });
      return balance as bigint;
    } catch {
      return 0n;
    }
  }
}
