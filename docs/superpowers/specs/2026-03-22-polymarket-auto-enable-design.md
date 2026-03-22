# Polymarket Plugin Auto-Enable

**Date:** 2026-03-22
**Status:** Approved

## Problem

The Polymarket plugin (`@elizaos/plugin-polymarket`) defaults to OFF in the plugin list. Users with Polymarket credentials in their environment must manually enable it. Other plugins (OpenAI, Anthropic, etc.) auto-enable when their API keys are detected. Polymarket should follow the same pattern.

## Goal

Auto-enable the Polymarket plugin (and its `evm` dependency) when `POLYMARKET_PRIVATE_KEY` or `CLOB_API_KEY` is present in the environment. Respect explicit user overrides (`plugins.entries.polymarket.enabled: false`).

## Approach

Single touch point in Milady's `collectPluginNames` wrapper (`packages/app-core/src/runtime/eliza.ts`), plus tests.

### Why not `AUTH_PROVIDER_PLUGINS`?

The upstream `applyPluginAutoEnable` deep-clones the config via `structuredClone` and its return value is discarded by the boot flow (`resolvePlugins` at line 1023 of upstream `eliza.js`). Mutations to the allow list never reach `collectPluginNames`. Patching `AUTH_PROVIDER_PLUGINS` would be a no-op at runtime.

### Why not upstream?

The auto-enable maps (`AUTH_PROVIDER_PLUGINS`, `OPTIONAL_PLUGIN_MAP`) live in `@elizaos/agent`. Upstreaming requires a PR + release cycle. This design ships immediately using Milady's existing wrapper pattern (same as Edge TTS, legacy channel names). Can be upstreamed later.

### Why not config-based default?

A config preset (`plugins.entries.polymarket.enabled: true`) would always show ON regardless of credentials. The requirement is credential-gated auto-enable.

## Design

### Single Touch Point: Env Detection + Plugin Injection in `collectPluginNames`

**File:** `packages/app-core/src/runtime/eliza.ts`, inside the existing `collectPluginNames` wrapper

The wrapper already conditionally adds plugins (Edge TTS when agent-orchestrator is present) and resolves legacy names. We add Polymarket auto-enable using the same pattern: check env vars, respect user overrides, add full package names directly.

```typescript
// Polymarket: auto-enable when credentials detected
const hasPolymarketCreds =
  process.env.POLYMARKET_PRIVATE_KEY?.trim() ||
  process.env.CLOB_API_KEY?.trim();

if (hasPolymarketCreds) {
  if (config?.plugins?.entries?.polymarket?.enabled !== false) {
    result.add("@elizaos/plugin-polymarket");
  }
  if (
    config?.plugins?.entries?.evm?.enabled !== false &&
    !result.has("@elizaos/plugin-evm")
  ) {
    result.add("@elizaos/plugin-evm");
  }
}

// Resolve short IDs that may arrive via other paths (allow list, manual config)
for (const [shortId, fullName] of [
  ["polymarket", "@elizaos/plugin-polymarket"],
  ["evm", "@elizaos/plugin-evm"],
] as const) {
  if (result.has(shortId)) {
    result.delete(shortId);
    result.add(fullName);
  }
}
```

**Why full package names?** The upstream `collectPluginNames` resolves allow-list entries through `CHANNEL_PLUGIN_MAP` and `OPTIONAL_PLUGIN_MAP`. Neither contains `"polymarket"` or `"evm"`, so short IDs would pass through as-is and `import("polymarket")` would fail. By adding the full `@elizaos/plugin-*` names directly, we bypass this resolution gap.

**Why check both polymarket AND evm user overrides?** If a user explicitly disables EVM (`plugins.entries.evm.enabled: false`), we respect that — same pattern as `isMiladyEdgeTtsDisabled(config)` for Edge TTS.

### Tests

**File:** `packages/app-core/src/runtime/eliza.test.ts` (or new `polymarket-auto-enable.test.ts`)

Test cases:

1. `POLYMARKET_PRIVATE_KEY` set → `collectPluginNames` result includes `@elizaos/plugin-polymarket` and `@elizaos/plugin-evm`
2. `CLOB_API_KEY` set → same
3. Neither set → neither plugin in result
4. `plugins.entries.polymarket.enabled: false` + env var set → `@elizaos/plugin-polymarket` not added
5. `plugins.entries.evm.enabled: false` + env var set → `@elizaos/plugin-evm` not added, but `@elizaos/plugin-polymarket` still added
6. Short ID `"polymarket"` in result (from allow list) → resolved to `@elizaos/plugin-polymarket`

### UI Behavior

No changes needed. `buildPluginListResponse` in `server.ts` checks `isPluginLoaded(pluginId, npmName, loadedNames)` — when Polymarket loads at runtime, this returns `true` and the UI shows the plugin as ON.

## Data Flow

```
Boot sequence:
  1. syncMiladyEnvToEliza()
  2. upstreamBootElizaRuntime() calls resolvePlugins(config) which calls:
     a. applyPluginAutoEnable({ config, env }) — return discarded (upstream bug)
     b. collectPluginNames(config) — Milady's wrapper runs:
        i.  Upstream collectPluginNames builds base set from core + allow + connectors + env
        ii. Milady wrapper: legacy name resolution
        iii. Milady wrapper: Edge TTS injection (existing)
        iv. Milady wrapper: Polymarket env detection (NEW)
            → checks POLYMARKET_PRIVATE_KEY / CLOB_API_KEY
            → if present and not user-disabled, adds @elizaos/plugin-polymarket + @elizaos/plugin-evm
        v.  Milady wrapper: short ID resolution for polymarket/evm (NEW)
     c. resolvePlugins() loads all plugins in the set
  3. UI queries /api/plugins → buildPluginListResponse sees polymarket active → reports ON
```

## Files Changed

| File | Change |
|------|--------|
| `packages/app-core/src/runtime/eliza.ts` | Extend `collectPluginNames` wrapper with Polymarket env detection + short ID resolution |
| `packages/app-core/src/runtime/eliza.test.ts` | Add Polymarket auto-enable test cases |

## Risks

- **Upstream fixes `applyPluginAutoEnable` discard bug:** If upstream starts using the return value, Polymarket would be double-added (once by upstream, once by our wrapper). No harm — `Set.add` is idempotent.
- **Upstream adds polymarket to `OPTIONAL_PLUGIN_MAP`:** Our short-ID resolution becomes redundant but not harmful.
- **EVM already loaded by another path:** No conflict — `Set.add` is idempotent.
