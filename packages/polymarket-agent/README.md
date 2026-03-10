# elizaOS Polymarket Trading Agent

Local operator shell for `@elizaos/plugin-polymarket`.

This package is TUI-first. It does not currently ship the old `once` / `run` loop shown in older docs.

## What It Does

- Starts an interactive Polymarket chat/operator session
- Verifies wallet + CLOB connectivity
- Configures `.env` interactively
- Exposes account, market, autonomy, and log views inside the TUI

## Setup

From the repo root:

```bash
bun install
cd packages/polymarket-agent
```

You can either set environment variables directly or run the setup wizard:

```bash
bun run polymarket-demo.ts settings
```

Supported LLM providers:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GROQ_API_KEY`
- `XAI_API_KEY`

Polymarket wallet settings:

```bash
export EVM_PRIVATE_KEY="0x..."
export CLOB_API_URL="https://clob.polymarket.com"
```

Optional CLOB credentials:

```bash
export CLOB_API_KEY="..."
export CLOB_API_SECRET="..."
export CLOB_API_PASSPHRASE="..."
```

## Commands

```bash
# Interactive setup wizard
bun run polymarket-demo.ts settings

# Validate wallet and Polymarket connectivity
bun run polymarket-demo.ts verify

# Launch the TUI chat/operator session
bun run polymarket-demo.ts chat

# Ink terminal input test
bun run polymarket-demo.ts input-test
```

If the package binary is installed, the same commands are available through:

```bash
polyagent settings
polyagent verify
polyagent chat
```

## Verify Behavior

`verify` is live. It initializes the runtime and attempts to derive Polymarket API credentials from the configured wallet when possible. It is not an offline config-only check.

## TUI Commands

Inside `chat`, these operator commands are available:

- `/account`
- `/markets`
- `/logs`
- `/autonomy true|false`
- `/think`
- `/interval <seconds>`

## Notes

- `--execute` enables real order placement.
- If you use a Polymarket proxy wallet, set `POLYMARKET_SIGNATURE_TYPE` and `POLYMARKET_FUNDER_ADDRESS` when auto-detection is not enough.
- Deep research in the upstream plugin still depends on `OPENAI_API_KEY`.

## Tests

```bash
bun test
```
