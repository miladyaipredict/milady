import type { AwarenessContributor } from "../../contracts/awareness";
import { cloudContributor } from "./cloud";
import { connectorsContributor } from "./connectors";
import { featuresContributor } from "./features";
import { permissionsContributor } from "./permissions";
import { pluginHealthContributor } from "./plugin-health";
import { providerContributor } from "./provider";
import { runtimeContributor } from "./runtime";
import { walletContributor } from "./wallet";

export const builtinContributors: AwarenessContributor[] = [
  runtimeContributor,
  permissionsContributor,
  walletContributor,
  providerContributor,
  pluginHealthContributor,
  connectorsContributor,
  cloudContributor,
  featuresContributor,
];

/**
 * Dynamically register trading plugin awareness contributors.
 * These are loaded lazily to avoid hard dependencies on plugins
 * that may not be installed or configured.
 */
export async function registerTradingContributors(
  registry: { register: (c: AwarenessContributor) => void },
): Promise<void> {
  // Opinion contributor
  try {
    const mod = await import("../../plugins/opinion/awareness/opinion-contributor.js");
    if (mod.opinionContributor) {
      registry.register(mod.opinionContributor as unknown as AwarenessContributor);
    }
  } catch {
    // Plugin not loaded, skip
  }

  // Limitless contributor
  try {
    const mod = await import("../../plugins/limitless/awareness/limitless-contributor.js");
    if (mod.limitlessContributor) {
      registry.register(mod.limitlessContributor as unknown as AwarenessContributor);
    }
  } catch {
    // Plugin not loaded, skip
  }
}
