import type { Plugin } from "@elizaos/core";
import { balanceAction } from "./actions/balance.js";
import { wrapAction } from "./actions/wrap.js";
import { unwrapAction } from "./actions/unwrap.js";
import { privateSendAction } from "./actions/private-send.js";

export { Zerc20Service } from "./service.js";
export { loadConfig } from "./config.js";
export { ALL_DEPLOYMENTS, findDeployment } from "./registry.js";
export type {
  Zerc20Balance,
  Zerc20ChainId,
  Zerc20Config,
  Zerc20Deployment,
  WrapResult,
  UnwrapResult,
  PrivateSendParams,
  PrivateSendResult,
  IncomingTransfer,
} from "./types.js";

export const zerc20Plugin: Plugin = {
  name: "@milady/plugin-zerc20",
  description:
    "Privacy-preserving ERC-20 transfers using zero-knowledge proofs (EIP-7503). Supports wrap, unwrap, private send, and cross-chain teleport for zETH, zBNB, and zUSDC.",
  actions: [balanceAction, wrapAction, unwrapAction, privateSendAction],
  evaluators: [],
  providers: [],
};

export default zerc20Plugin;
