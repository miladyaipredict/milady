import type { Address } from "viem";
import type { Zerc20ChainId, Zerc20Deployment } from "./types.js";

/**
 * Mainnet deployed contract addresses for zERC20 tokens.
 * Source: https://github.com/aspect-build/zerc20 config/deployed/mainnet/
 */

export const ZETH_DEPLOYMENTS: readonly Zerc20Deployment[] = [
  {
    chainId: 1,
    label: "eth-mainnet",
    tokenAddress: "0x410056c6F0A9ABD8c42b9eEF3BB451966Fb0d924" as Address,
    verifierAddress: "0xdCC76DEbb526Eef0210Bd38729b803591951Ab34" as Address,
    liquidityManagerAddress: "0xcC10b7098FEf1aB2f0FF3bE91d2A7B3230b90CF0" as Address,
    adaptorAddress: "0xfDe2C5758BbdDcDEa2d73EdeB5C13DE98B21Eb7D" as Address,
    rpcUrls: ["https://eth.llamarpc.com"],
  },
  {
    chainId: 42161,
    label: "arb-mainnet",
    tokenAddress: "0x410056c6F0A9ABD8c42b9eEF3BB451966Fb0d924" as Address,
    verifierAddress: "0xdCC76DEbb526Eef0210Bd38729b803591951Ab34" as Address,
    liquidityManagerAddress: "0xcC10b7098FEf1aB2f0FF3bE91d2A7B3230b90CF0" as Address,
    adaptorAddress: "0xfDe2C5758BbdDcDEa2d73EdeB5C13DE98B21Eb7D" as Address,
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
  },
  {
    chainId: 8453,
    label: "base-mainnet",
    tokenAddress: "0x410056c6F0A9ABD8c42b9eEF3BB451966Fb0d924" as Address,
    verifierAddress: "0xdCC76DEbb526Eef0210Bd38729b803591951Ab34" as Address,
    liquidityManagerAddress: "0xcC10b7098FEf1aB2f0FF3bE91d2A7B3230b90CF0" as Address,
    adaptorAddress: "0xfDe2C5758BbdDcDEa2d73EdeB5C13DE98B21Eb7D" as Address,
    hubAddress: "0x6B5e8509ae57A54863A7255e610d6F0c10FCAFB5" as Address,
    rpcUrls: ["https://mainnet.base.org"],
  },
] as const;

export const ZBNB_DEPLOYMENTS: readonly Zerc20Deployment[] = [
  {
    chainId: 56,
    label: "bnb-mainnet",
    tokenAddress: "0x4388D5618B9e13Bd580209CDf37a202778C75c54" as Address,
    verifierAddress: "0xb05977Af4aA54117910ed72141F674531894774A" as Address,
    liquidityManagerAddress: "0x39Cc069dF606c7bc8c79b0ADd0696BCaf548eFD9" as Address,
    hubAddress: "0x35eE54CEDb9aba3b785C493C0B50643E65471c7A" as Address,
    rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  },
  {
    chainId: 1,
    label: "eth-mainnet",
    tokenAddress: "0x4388D5618B9e13Bd580209CDf37a202778C75c54" as Address,
    verifierAddress: "0xb05977Af4aA54117910ed72141F674531894774A" as Address,
    liquidityManagerAddress: "0x39Cc069dF606c7bc8c79b0ADd0696BCaf548eFD9" as Address,
    rpcUrls: ["https://eth.llamarpc.com"],
  },
  {
    chainId: 42161,
    label: "arb-mainnet",
    tokenAddress: "0x4388D5618B9e13Bd580209CDf37a202778C75c54" as Address,
    verifierAddress: "0xb05977Af4aA54117910ed72141F674531894774A" as Address,
    liquidityManagerAddress: "0x39Cc069dF606c7bc8c79b0ADd0696BCaf548eFD9" as Address,
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
  },
  {
    chainId: 8453,
    label: "base-mainnet",
    tokenAddress: "0x4388D5618B9e13Bd580209CDf37a202778C75c54" as Address,
    verifierAddress: "0xb05977Af4aA54117910ed72141F674531894774A" as Address,
    liquidityManagerAddress: "0x39Cc069dF606c7bc8c79b0ADd0696BCaf548eFD9" as Address,
    rpcUrls: ["https://mainnet.base.org"],
  },
] as const;

export const ZUSDC_DEPLOYMENTS: readonly Zerc20Deployment[] = [
  {
    chainId: 1,
    label: "eth-mainnet",
    tokenAddress: "0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53" as Address,
    verifierAddress: "0xfb786B5E6520284Aa6a8dFA3B4F7A09ed423e25f" as Address,
    liquidityManagerAddress: "0x04be137Df79bE7B5F3314C4a84D1C5E0d99BD477" as Address,
    adaptorAddress: "0x3fCBc7f919b712258859e2e3c78188168E47B287" as Address,
    rpcUrls: ["https://eth.llamarpc.com"],
  },
  {
    chainId: 42161,
    label: "arb-mainnet",
    tokenAddress: "0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53" as Address,
    verifierAddress: "0xfb786B5E6520284Aa6a8dFA3B4F7A09ed423e25f" as Address,
    liquidityManagerAddress: "0x04be137Df79bE7B5F3314C4a84D1C5E0d99BD477" as Address,
    adaptorAddress: "0x3fCBc7f919b712258859e2e3c78188168E47B287" as Address,
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
  },
  {
    chainId: 8453,
    label: "base-mainnet",
    tokenAddress: "0xEB81ab55Bc7aa89d1e0E3F60597D86e37702Af53" as Address,
    verifierAddress: "0xfb786B5E6520284Aa6a8dFA3B4F7A09ed423e25f" as Address,
    liquidityManagerAddress: "0x04be137Df79bE7B5F3314C4a84D1C5E0d99BD477" as Address,
    adaptorAddress: "0x3fCBc7f919b712258859e2e3c78188168E47B287" as Address,
    hubAddress: "0x0E81e4CF6C8B408bC40D7AC8240bBc12CdD56F1D" as Address,
    rpcUrls: ["https://mainnet.base.org"],
  },
] as const;

/** All token deployments grouped by symbol. */
export const ALL_DEPLOYMENTS = {
  zETH: ZETH_DEPLOYMENTS,
  zBNB: ZBNB_DEPLOYMENTS,
  zUSDC: ZUSDC_DEPLOYMENTS,
} as const;

/** Find a deployment for a specific token + chain. */
export function findDeployment(
  symbol: keyof typeof ALL_DEPLOYMENTS,
  chainId: Zerc20ChainId,
): Zerc20Deployment | undefined {
  return ALL_DEPLOYMENTS[symbol].find((d) => d.chainId === chainId);
}
