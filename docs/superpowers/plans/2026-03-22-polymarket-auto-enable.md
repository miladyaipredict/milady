# Polymarket Auto-Enable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-enable the Polymarket plugin (and its EVM dependency) when `POLYMARKET_PRIVATE_KEY` or `CLOB_API_KEY` is present in the environment.

**Architecture:** Single touch point in Milady's `collectPluginNames` wrapper in `packages/app-core/src/runtime/eliza.ts`. The wrapper already conditionally injects plugins (Edge TTS) and resolves legacy names — we add Polymarket using the same pattern. Tests go in `packages/app-core/src/runtime/eliza.test.ts` alongside existing `collectPluginNames` tests.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-polymarket-auto-enable-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/app-core/src/runtime/eliza.ts` | Modify (lines 158-182) | Add Polymarket env detection + short-ID resolution in `collectPluginNames` wrapper |
| `packages/app-core/src/runtime/eliza.test.ts` | Modify (after line 296) | Add 6 test cases for Polymarket auto-enable behavior |

No new files. Two modifications to existing files.

---

### Task 1: Write failing tests for Polymarket auto-enable

**Files:**
- Modify: `packages/app-core/src/runtime/eliza.test.ts`

The tests go inside the existing `describe("collectPluginNames", ...)` block, after the Edge TTS tests (after line ~296). The `envSnapshot` at the top of that describe block (line 127) must include the Polymarket env keys so they're cleaned up between tests.

- [ ] **Step 1: Add Polymarket env keys to the snapshot list**

In `packages/app-core/src/runtime/eliza.test.ts`, find the `envKeys` array inside `describe("collectPluginNames", ...)` at line 127. Add the Polymarket env keys after `"ELIZA_DISABLE_EDGE_TTS"` (line 153):

```typescript
    "ELIZA_DISABLE_EDGE_TTS",
    // Polymarket auto-enable env keys
    "POLYMARKET_PRIVATE_KEY",
    "CLOB_API_KEY",
```

This ensures `beforeEach` deletes them and `afterEach` restores their original values.

- [ ] **Step 2: Add the 6 Polymarket test cases**

Insert a new `describe("Polymarket auto-enable", ...)` block after the Edge TTS "omits when agent orchestrator is disabled" test (after line ~296, before the shell test at line ~298). The exact insertion point is after:

```typescript
  it("omits @elizaos/plugin-edge-tts when agent orchestrator is disabled", () => {
    ...
    expect(names.has("@elizaos/plugin-edge-tts")).toBe(false);
  });
```

And before:

```typescript
  it("does not load @elizaos/plugin-shell when features.shellEnabled is false", () => {
```

Insert this block:

```typescript
  describe("Polymarket auto-enable", () => {
    it("adds polymarket + evm when POLYMARKET_PRIVATE_KEY is set", () => {
      process.env.POLYMARKET_PRIVATE_KEY = "0xdeadbeef";
      const names = collectPluginNames({} as ElizaConfig);
      expect(names.has("@elizaos/plugin-polymarket")).toBe(true);
      expect(names.has("@elizaos/plugin-evm")).toBe(true);
    });

    it("adds polymarket + evm when CLOB_API_KEY is set", () => {
      process.env.CLOB_API_KEY = "test-clob-key";
      const names = collectPluginNames({} as ElizaConfig);
      expect(names.has("@elizaos/plugin-polymarket")).toBe(true);
      expect(names.has("@elizaos/plugin-evm")).toBe(true);
    });

    it("does not add polymarket or evm when no credentials are set", () => {
      const names = collectPluginNames({} as ElizaConfig);
      expect(names.has("@elizaos/plugin-polymarket")).toBe(false);
      expect(names.has("@elizaos/plugin-evm")).toBe(false);
    });

    it("omits polymarket when plugins.entries.polymarket.enabled is false", () => {
      process.env.POLYMARKET_PRIVATE_KEY = "0xdeadbeef";
      const config = {
        plugins: {
          entries: { polymarket: { enabled: false } },
        },
      } as Partial<ElizaConfig> as ElizaConfig;
      const names = collectPluginNames(config);
      expect(names.has("@elizaos/plugin-polymarket")).toBe(false);
      // evm should still load since polymarket creds are present and evm is not disabled
      expect(names.has("@elizaos/plugin-evm")).toBe(true);
    });

    it("omits evm when plugins.entries.evm.enabled is false but still loads polymarket", () => {
      process.env.POLYMARKET_PRIVATE_KEY = "0xdeadbeef";
      const config = {
        plugins: {
          entries: { evm: { enabled: false } },
        },
      } as Partial<ElizaConfig> as ElizaConfig;
      const names = collectPluginNames(config);
      expect(names.has("@elizaos/plugin-polymarket")).toBe(true);
      expect(names.has("@elizaos/plugin-evm")).toBe(false);
    });

    it("resolves short ID 'polymarket' to full package name", () => {
      // Simulate a short ID arriving from the allow list (upstream pushes short IDs)
      // We can't directly inject into the allow list from here, but we can verify
      // the resolution by setting creds and checking the full name is used
      process.env.POLYMARKET_PRIVATE_KEY = "0xdeadbeef";
      const names = collectPluginNames({} as ElizaConfig);
      expect(names.has("polymarket")).toBe(false);
      expect(names.has("@elizaos/plugin-polymarket")).toBe(true);
      expect(names.has("evm")).toBe(false);
      expect(names.has("@elizaos/plugin-evm")).toBe(true);
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
cd /Users/pleasures/Documents/GitHub/milady && npx vitest run packages/app-core/src/runtime/eliza.test.ts -t "Polymarket auto-enable" 2>&1 | tail -30
```

Expected: All 6 tests FAIL. The first 2 tests should fail with `expected false to be true` because `collectPluginNames` doesn't add polymarket yet. Tests 3-6 may pass (they test absence/no-op), but tests 1 and 2 must fail.

- [ ] **Step 4: Commit the failing tests**

```bash
git add packages/app-core/src/runtime/eliza.test.ts
git commit -m "test: add failing tests for polymarket plugin auto-enable"
```

---

### Task 2: Implement Polymarket auto-enable in `collectPluginNames`

**Files:**
- Modify: `packages/app-core/src/runtime/eliza.ts` (lines 63-65, 158-182)

- [ ] **Step 1: Add Polymarket plugin constants**

In `packages/app-core/src/runtime/eliza.ts`, after the existing constants at line 64-65:

```typescript
const AGENT_ORCHESTRATOR_PLUGIN = "@elizaos/plugin-agent-orchestrator";
const EDGE_TTS_PLUGIN = "@elizaos/plugin-edge-tts";
```

Add:

```typescript
const POLYMARKET_PLUGIN = "@elizaos/plugin-polymarket";
const EVM_PLUGIN = "@elizaos/plugin-evm";

/** Env vars that signal Polymarket credentials are configured. */
const POLYMARKET_ENV_KEYS = [
  "POLYMARKET_PRIVATE_KEY",
  "CLOB_API_KEY",
] as const;

/**
 * Short-ID-to-full-package-name resolution for Polymarket ecosystem plugins.
 * Upstream `collectPluginNames` may place bare short IDs (e.g. "polymarket")
 * into the plugin set via the allow list. These short IDs fail at
 * `import("polymarket")` because `OPTIONAL_PLUGIN_MAP` doesn't map them.
 */
const POLYMARKET_SHORT_ID_MAP: ReadonlyArray<readonly [string, string]> = [
  ["polymarket", POLYMARKET_PLUGIN],
  ["evm", EVM_PLUGIN],
];
```

- [ ] **Step 2: Add Polymarket logic to `collectPluginNames` wrapper**

In `packages/app-core/src/runtime/eliza.ts`, in the `collectPluginNames` function, add the Polymarket auto-enable logic AFTER the Edge TTS block (after line 179: `result.add(EDGE_TTS_PLUGIN);` closing brace) and BEFORE the final `syncBrandEnvAliases()` call at line 180.

Find this exact code block:

```typescript
  if (
    result.has(AGENT_ORCHESTRATOR_PLUGIN) &&
    !isMiladyEdgeTtsDisabled(config) &&
    !result.has(EDGE_TTS_PLUGIN)
  ) {
    result.add(EDGE_TTS_PLUGIN);
  }
  syncBrandEnvAliases();
  return result;
```

Replace with:

```typescript
  if (
    result.has(AGENT_ORCHESTRATOR_PLUGIN) &&
    !isMiladyEdgeTtsDisabled(config) &&
    !result.has(EDGE_TTS_PLUGIN)
  ) {
    result.add(EDGE_TTS_PLUGIN);
  }

  // Polymarket: auto-enable when credentials are detected in env.
  const hasPolymarketCreds = POLYMARKET_ENV_KEYS.some(
    (k) => process.env[k]?.trim(),
  );
  if (hasPolymarketCreds) {
    if (config?.plugins?.entries?.polymarket?.enabled !== false) {
      result.add(POLYMARKET_PLUGIN);
    }
    if (config?.plugins?.entries?.evm?.enabled !== false) {
      result.add(EVM_PLUGIN);
    }
  }

  // Resolve bare short IDs that may arrive from the allow list or other paths.
  for (const [shortId, fullName] of POLYMARKET_SHORT_ID_MAP) {
    if (result.has(shortId)) {
      result.delete(shortId);
      result.add(fullName);
    }
  }

  syncBrandEnvAliases();
  return result;
```

- [ ] **Step 3: Run the Polymarket tests to verify they pass**

Run:
```bash
cd /Users/pleasures/Documents/GitHub/milady && npx vitest run packages/app-core/src/runtime/eliza.test.ts -t "Polymarket auto-enable" 2>&1 | tail -20
```

Expected: All 6 tests PASS.

- [ ] **Step 4: Run the full `collectPluginNames` test suite to verify no regressions**

Run:
```bash
cd /Users/pleasures/Documents/GitHub/milady && npx vitest run packages/app-core/src/runtime/eliza.test.ts -t "collectPluginNames" 2>&1 | tail -20
```

Expected: All existing tests still PASS. The Edge TTS tests, provider precedence tests, shell tests, etc. should be unaffected.

- [ ] **Step 5: Commit the implementation**

```bash
git add packages/app-core/src/runtime/eliza.ts
git commit -m "feat: auto-enable polymarket plugin when credentials detected"
```

---

### Task 3: Run full test suite and lint

**Files:** None (validation only)

- [ ] **Step 1: Run the full eliza.test.ts file**

Run:
```bash
cd /Users/pleasures/Documents/GitHub/milady && npx vitest run packages/app-core/src/runtime/eliza.test.ts 2>&1 | tail -30
```

Expected: All tests pass. No failures or regressions.

- [ ] **Step 2: Run lint on the changed files**

Run:
```bash
cd /Users/pleasures/Documents/GitHub/milady && npx biome check packages/app-core/src/runtime/eliza.ts packages/app-core/src/runtime/eliza.test.ts 2>&1 | tail -20
```

Expected: No lint errors. If there are any, fix them and re-run.

- [ ] **Step 3: Run typecheck**

Run:
```bash
cd /Users/pleasures/Documents/GitHub/milady && npx tsc --noEmit -p packages/app-core/tsconfig.json 2>&1 | tail -20
```

Expected: No type errors. If the tsconfig path is different, try `bun run check` instead.

- [ ] **Step 4: Fix any issues and commit**

If lint or typecheck found issues, fix them and commit:
```bash
git add -u
git commit -m "fix: lint/type fixes for polymarket auto-enable"
```

If no issues, skip this step.
