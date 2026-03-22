# Polymarket Plugin Auto-Enable

**Date:** 2026-03-22
**Status:** Approved

## Problem

The Polymarket plugin (`@elizaos/plugin-polymarket`) defaults to OFF in the plugin list. Users with Polymarket credentials in their environment must manually enable it. Other plugins (OpenAI, Anthropic, etc.) auto-enable when their API keys are detected. Polymarket should follow the same pattern.

## Goal

Auto-enable the Polymarket plugin (and its `evm` dependency) when `POLYMARKET_PRIVATE_KEY` or `CLOB_API_KEY` is present in the environment. Respect explicit user overrides (`plugins.entries.polymarket.enabled: false`).

## Approach

Milady-local extension of the upstream auto-enable mechanism. Two touch points in `packages/app-core/src/runtime/eliza.ts`, plus tests.

### Why not upstream?

The auto-enable maps (`AUTH_PROVIDER_PLUGINS`, `OPTIONAL_PLUGIN_MAP`) live in `@elizaos/agent`. Upstreaming requires a PR + release cycle. This design ships immediately using Milady's existing wrapper pattern (same as Edge TTS, legacy channel names). Can be upstreamed later.

### Why not config-based default?

A config preset (`plugins.entries.polymarket.enabled: true`) would always show ON regardless of credentials. The requirement is credential-gated auto-enable.

## Design

### Touch Point 1: Env Detection — Patch `AUTH_PROVIDER_PLUGINS`

**File:** `packages/app-core/src/runtime/eliza.ts` (module-level)

Mutate the upstream `AUTH_PROVIDER_PLUGINS` object (exported as `const` — binding is const, object is mutable) to add Polymarket env var mappings:

```typescript
import { AUTH_PROVIDER_PLUGINS } from "../config/plugin-auto-enable";

AUTH_PROVIDER_PLUGINS["POLYMARKET_PRIVATE_KEY"] = "@elizaos/plugin-polymarket";
AUTH_PROVIDER_PLUGINS["CLOB_API_KEY"] = "@elizaos/plugin-polymarket";
```

**Effect:** When the upstream `applyPluginAutoEnable` runs during boot, it iterates `Object.entries(AUTH_PROVIDER_PLUGINS)`. If either env var is set and non-empty, it pushes the short ID `"polymarket"` to `config.plugins.allow`. It respects `plugins.entries.polymarket.enabled === false` (skip if explicitly disabled).

### Touch Point 2: Name Resolution — Extend `collectPluginNames` Wrapper

**File:** `packages/app-core/src/runtime/eliza.ts`, inside the existing `collectPluginNames` wrapper

The upstream `collectPluginNames` resolves allow-list entries through `CHANNEL_PLUGIN_MAP` and `OPTIONAL_PLUGIN_MAP`. Neither contains `"polymarket"` or `"evm"`, so the short IDs pass through as-is and `import("polymarket")` would fail at runtime.

Add short-ID-to-full-package resolution (same pattern as `LEGACY_INTERNAL_CHANNEL_PLUGIN_NAMES`):

```typescript
const POLYMARKET_PLUGIN_RESOLUTION: ReadonlyArray<[string, string]> = [
  ["polymarket", "@elizaos/plugin-polymarket"],
  ["evm", "@elizaos/plugin-evm"],
];

// Inside collectPluginNames, after upstream call and legacy name resolution:
for (const [shortId, fullName] of POLYMARKET_PLUGIN_RESOLUTION) {
  if (result.has(shortId)) {
    result.delete(shortId);
    result.add(fullName);
  }
}

// Ensure evm dependency loads alongside polymarket
if (
  result.has("@elizaos/plugin-polymarket") &&
  !result.has("@elizaos/plugin-evm")
) {
  result.add("@elizaos/plugin-evm");
}
```

### Touch Point 3: Tests

**File:** `packages/app-core/src/config/plugin-auto-enable.test.ts`

Add test cases:

1. `POLYMARKET_PRIVATE_KEY` set → `applyPluginAutoEnable` adds `"polymarket"` to `plugins.allow`
2. `CLOB_API_KEY` set → same
3. Neither set → `"polymarket"` not in allow list
4. `plugins.entries.polymarket.enabled: false` + env var set → `"polymarket"` not added (user override)

### UI Behavior

No changes needed. `buildPluginListResponse` in `server.ts` checks `isPluginLoaded(pluginId, npmName, loadedNames)` — when Polymarket loads at runtime, this returns `true` and the UI shows the plugin as ON.

## Data Flow

```
Boot sequence:
  1. syncMiladyEnvToEliza()
  2. upstreamBootElizaRuntime() calls:
     a. applyPluginAutoEnable({ config, env: process.env })
        → iterates AUTH_PROVIDER_PLUGINS (now includes POLYMARKET_PRIVATE_KEY, CLOB_API_KEY)
        → if env var present, pushes "polymarket" to config.plugins.allow
     b. collectPluginNames(config)
        → upstream reads config.plugins.allow, adds "polymarket" to pluginsToLoad
        → Milady wrapper resolves "polymarket" → "@elizaos/plugin-polymarket"
        → Milady wrapper ensures "@elizaos/plugin-evm" is also in set
     c. resolvePlugins() loads all plugins in pluginsToLoad
  3. UI queries /api/plugins → buildPluginListResponse sees polymarket active → reports ON
```

## Files Changed

| File | Change |
|------|--------|
| `packages/app-core/src/runtime/eliza.ts` | Patch `AUTH_PROVIDER_PLUGINS` at module level; extend `collectPluginNames` wrapper |
| `packages/app-core/src/config/plugin-auto-enable.test.ts` | Add Polymarket auto-enable test cases |

## Risks

- **`AUTH_PROVIDER_PLUGINS` mutation:** Relies on the upstream object being mutable. If upstream freezes it (`Object.freeze`), the mutation silently fails. Mitigated by: tests verify the keys exist after mutation.
- **Upstream adds polymarket natively:** No conflict — if upstream adds the same keys, both push the same short ID; `addToAllowlist` deduplicates.
- **EVM already loaded:** No conflict — `Set.add` is idempotent.
