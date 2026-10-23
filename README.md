# eco-footprint

Estimated environmental footprint (energy, CO2e) of your coding agents in
[Paseo](https://paseo.sh), powered by [EcoLogits](https://ecologits.ai).

A line in the Paseo sidebar footer, next to the token usage summary, shows
today's estimated energy and CO2e of the LLM usage of the agents on your
machine. Press it for day / week / month totals, a chart by model, and a full
screen with the methodology behind the numbers.

## What it shows

- **Sidebar footer line**: today's energy (Wh) and CO2e (g), with a small
  meter. The fill is today's CO2e split by model; the vertical line marks a
  typical day (the median of your active days in the last 28).
- **Popover**: day / week / month totals, the change against the previous
  period, a stacked chart by model, a per-model list, and a folded-away
  "everyday equivalents" section (phone charges, cups of coffee, car
  kilometres) to feel the scale.
- **Full screen** (also in the Command Center): longer history, per-model
  breakdown and a plain-word methodology section.

## How it works

The plugin reads the local session journals of [Mistral
Vibe](https://github.com/mistralai/vibe) agents and the session logs of
[Claude Code](https://claude.com/claude-code) agents, which record the token
usage of every model generation, and keeps its own ledger with timestamps.
Vibe journals have no timestamps, so on the first run the existing journals
are backfilled once, attributed to session start dates and marked as
estimated history. Claude Code logs carry real timestamps, so their history
keeps its true daily split. After that it reads only file tails (byte
offsets) and refreshes when an agent finishes a turn.

Impacts are computed with
[@ecologits/ecologits.js](https://www.npmjs.com/package/@ecologits/ecologits.js),
the TypeScript port of the EcoLogits methodology: energy and CO2e (usage +
embodied) from the model's parameter count and the output token count. Each
provider is estimated with its own EcoLogits defaults (Mistral models with
the Swedish mix, Anthropic models with the US mix). Days are grouped in
your timezone, the one Paseo runs in for you, not the daemon's.

Nothing leaves your machine: all data is read locally and the EcoLogits model
data is compiled into the package.

## Install

Requires Paseo 0.11.1 or later with plugins enabled on the daemon.

```bash
paseo plugin install github:JordiBolibar/paseo-eco-footprint
```

## Settings

- `electricityMixZone`: ISO 3166-1 alpha-3 zone for the electricity mix
  (empty = each provider's EcoLogits default, for example SWE for Mistral
  and USA for Anthropic).
- `defaultModel`: model assumed for sessions that do not record one
  (default `glm-5-3`).
- `defaultParameterCountBillions`: assumed size for models not in the
  EcoLogits data (default 70).

## Limits, stated honestly

- These are estimates from a model, not measurements. Read them as orders of
  magnitude.
- The estimate is driven by output tokens only.
- The electricity mix zone is an assumption, not a measured region.
- Only usage logged on this machine is counted. Local models (for example a
  local llamacpp server) are not counted.
- Vibe history from before the plugin was installed has no daily split.
  Claude Code history keeps its real daily split.

## Develop

```bash
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin reload eco-footprint
paseo plugin logs eco-footprint
```

## Credits

- [EcoLogits](https://ecologits.ai) by the CodeCarbon non-profit: the
  methodology and the impact data (MPL-2.0, used as an npm dependency).
- [paseo-kit](https://github.com/a31521424/paseo-kit)'s ccusage-stats plugin:
  the structural template for the sidebar, popover and screen (Apache-2.0).

## License

Apache-2.0. See [LICENSE](LICENSE).
