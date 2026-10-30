# Plan: real deployment stats for the Mistral GLM models

## Problem

The efficiency card shows GLM 5.3 much less efficient than Opus/Sonnet. Two causes
in the vendored EcoLogits data (`@ecologits/ecologits.js` 3.0.0, synced 2026-10-02):

1. The `zai-glm-5-3` entry (and `zai-glm-5`, `zai-glm-5-2`, `zai-glm-latest`) has
   `tps: null, ttft: null`. With no throughput data, EcoLogits falls back to a
   latency regression that assumes ~15 tokens/s for a 40B-active model. Mistral's
   real GLM 5.3 endpoints run at ~105-116 tokens/s (OpenRouter, p50, 30-min
   windows). The fallback inflates the server-energy and embodied parts of every
   GLM estimate.
2. Claude entries carry estimated parameter ranges (nothing released by Anthropic)
   and the plugin displays their lower bound. That part is an assumption we cannot
   verify and do not touch.

Measured-energy services (ML.ENERGY, AI Energy Score) have no GLM-5 entries, so the
parameter-based energy model stays. The fixable, defensible input is the missing
throughput/latency data, taken from the same source EcoLogits itself uses
(OpenRouter endpoint stats).

## Change (one file: `server/ecologits.ts`)

1. Add a small override table with a source comment:

   ```ts
   // Real-world deployment stats for registered models whose EcoLogits entry has
   // none (tps null). Source: OpenRouter endpoint stats for Mistral's own
   // endpoints, p50 throughput / time to first token, retrieved 2026-10-30.
   const DEPLOYMENT_STATS_OVERRIDES: Record<string, { tps: number; ttft: number }> = {
     "zai-glm-5-3":     { tps: 114, ttft: 0.75 },
     "zai-glm-5-2":     { tps: 99, ttft: 0.93 },
     "zai-glm-5":       { tps: 114, ttft: 0.75 },
     "zai-glm-latest":  { tps: 114, ttft: 0.75 },
   };
   ```

   (Median of Mistral's endpoints: 5.3 has three, 105.5/114/116 tok/s and
   0.64/0.75/0.99 s; 5.2 has two, 81.0/117.0 tok/s and 1.19/0.67 s. GLM 5 has
   no Mistral endpoints on OpenRouter, so it and zai-glm-latest borrow the 5.3
   measurement. The registered `glm-5-2` entry keeps its own data value,
   57.5 tok/s; we only fill null entries.)

2. In `computeModelImpacts`: when the registered model has `deployment.tps == null`
   and an override exists, call `computeLlmImpacts` directly with the registered
   architecture parameters plus the override `tps`/`ttft`, the provider PUE/WUE
   and the zone electricity mix (same call pattern as the existing unknown-model
   path). Otherwise keep the current `llmImpacts` call untouched.

3. No ledger change. The ledger stores raw token counts and impacts are computed
   at report time, so the whole history (1,692 GLM records, ~8M output tokens)
   re-derives automatically. That is the retrospective fix.

## Expected effect (GLM 5.3, per 1,000 output tokens)

| Metric | Now | After | Change |
|---|---|---|---|
| Energy | 3.96 Wh | ~2.58 Wh | -35% |
| CO2e total (usage + embodied) | ~0.49 g | ~0.14 g | -71% |

Embodied drops the most because it scales with the assumed generation latency
(66.6 s -> 9.5 s per 1,000 tokens). On the efficiency card GLM 5.3 then comes out
more efficient than Opus 5.5's lower bound (3.18 Wh); Sonnet 5.5 stays ahead
(1.16 Wh) on the strength of EcoLogits' 293B size estimate for Claude.

## Verification

- `npm run typecheck`.
- `paseo plugin reload eco-footprint`, then check the efficiency card and the
  per-model breakdown against the numbers above.
- Spot-check: recompute one ledger record by hand with the same formulas.

## Out of scope (separate decisions, not in this change)

- Displaying min-max ranges for `model-arch-not-released` models (Claude) instead
  of the lower bound. Would make the card more honest, but changes what the plugin
  shows everywhere.
- Upstream PR to mlco2/ecologits adding the same tps/ttft to the `zai-glm-*` entries
  in `models.json`. Recommended as a follow-up: it fixes the root cause for
  everyone, and a future ecologits.js sync makes the local override redundant.
- Touching `node_modules` (lost on `npm ci`).

## Branch

`fix/glm-deployment-stats` in this repo (currently on `main`; per the workflow
rules main is not edited directly). The live plugin runs from this folder, so after
the change: `paseo plugin reload eco-footprint`.

## Status

Implemented on `fix/glm-deployment-stats`, typecheck clean, plugin reloaded.
Ledger replay through both paths: GLM 5.3 31.82 -> 20.62 kWh (-35%), CO2e
3910 -> 1101 g (-72%); every other model byte-identical. Independent review #1:
code correct, one Medium + four Low findings, all applied (per-model values for
`zai-glm-5-2`, explicit borrow note for `zai-glm-5`/`zai-glm-latest`, guard
comment, methodology notes in README/OVERVIEW/screen, reference numbers above
corrected to the vendored data).

Review #2 (fresh reviewer): every check reproduced (bit-identical library
paths, full ledger replay, medians, typecheck), trust clean; one Low wording
finding — the docs said the EcoLogits data ships no throughput for the
Mistral GLM models, but the vendored `glm-5-2` entry ships its own — fixed to
"their EcoLogits entries ship no throughput data" in README/OVERVIEW/screen.

Review #3 (fresh reviewer): no correctness findings; two Low wording findings
remain open in the same docs/UI sentence (the subject still covers `glm-5-2`,
and the note does not say that `zai-glm-5`/`zai-glm-latest` borrow the 5.3
measurement). Shipped as-is by decision; candidates for a small follow-up
commit or the upstream PR.
