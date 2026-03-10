import type { Address, Hash } from "viem";

/** Supported zERC20 chain IDs. */
export type Zerc20ChainId = 1 | 56 | 8453 | 42161;

/** Deployed contract addresses for a single chain. */
export interface Zerc20Deployment {
  chainId: Zerc20ChainId;
  label: string;
  tokenAddress: Address;
  verifierAddress: Address;
  liquidityManagerAddress?: Address;
  adaptorAddress?: Address;
  hubAddress?: Address;
  rpcUrls: readonly string[];
}

/** Runtime configuration for the plugin. */
export interface Zerc20Config {
  privateKey?: string;
  seedHex?: string;
  indexerUrl: string;
  deciderUrl: string;
}

/** Balance info for a single chain + token pair. */
export interface Zerc20Balance {
  chainId: Zerc20ChainId;
  symbol: string;
  balance: bigint;
  formatted: string;
}

/** Result of a wrap operation. */
export interface WrapResult {
  txHash: Hash;
  chainId: Zerc20ChainId;
  amount: bigint;
  token: string;
}

/** Result of an unwrap operation. */
export interface UnwrapResult {
  txHash: Hash;
  chainId: Zerc20ChainId;
  amount: bigint;
  token: string;
}

/** Parameters for a private send. */
export interface PrivateSendParams {
  recipientAddress: Address;
  recipientChainId: Zerc20ChainId;
  amount: bigint;
  token: string;
}

/** Result of a private send operation. */
export interface PrivateSendResult {
  burnAddress: Address;
  paymentAdviceId: string;
  token: string;
  amount: bigint;
}

/** An incoming private transfer detected by scanning. */
export interface IncomingTransfer {
  burnAddress: Address;
  chainId: Zerc20ChainId;
  amount: bigint;
  createdAt: bigint;
  redeemable: boolean;
}
