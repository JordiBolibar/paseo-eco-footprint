# eco-footprint

Estimated environmental footprint (energy, CO2e) of your coding agents, powered
by [EcoLogits](https://ecologits.ai).

## What it shows

A line in the sidebar footer, next to the token usage summary, shows today's
estimated energy (Wh) and CO2e (g) of the LLM usage of the agents on this
machine, with a small meter against a typical day (the median of the active
days in the last 28). Press it for a popover with day / week / month totals, the
change against the previous period and a stacked chart by model. The full
screen (also in the Command Center) shows longer history, a per-model breakdown
and a methodology section.

## How it works

The server reads the local Vibe session journals
(`~/.vibe/logs/session/unified/`), which record the token usage of every model
generation, and keeps its own ledger at
`~/.paseo/plugin-data/eco-footprint/ledger.jsonl` with timestamps. On the
first run it backfills the existing journals once, attributed to session start
dates and marked as estimated history. After that it reads only journal tails
(byte offsets) and refreshes when an agent finishes a turn.

Impacts are computed with `@ecologits/ecologits.js` (EcoLogits methodology):
energy, CO2e (usage + embodied), from the model's parameter count and the
output token count. The electricity mix zone defaults to EcoLogits's
assumption for the provider (SWE for Mistral); set another ISO alpha-3 zone in
the plugin settings. Models not in the EcoLogits data are estimated from a
default parameter count (setting) and marked "est." in the UI.

## Limits

- Estimates from a model, not measurements. Read them as orders of magnitude.
- The estimate is driven by output tokens only.
- Only usage logged on this machine is counted. Local models (for example
  devstral on llamacpp) are not counted.
- History from before the plugin was installed has no daily split.

## Settings

- `electricityMixZone`: ISO 3166-1 alpha-3 zone, empty = provider default.
- `defaultModel`: model assumed for sessions that do not record one
  (default `glm-5-3`).
- `defaultParameterCountBillions`: assumed size for unknown models (default 70).

## Develop

```bash
npm run typecheck
paseo plugin reload eco-footprint
paseo plugin logs eco-footprint
```

Requires Paseo 0.11.1 or later with plugins enabled on the daemon.
