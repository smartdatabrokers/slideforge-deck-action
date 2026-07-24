# SlideForge Deck — GitHub Action

**Render an editable PowerPoint (`.pptx`) from a JSON file, in CI.** Point it at a file of slide
intents and it writes a real `.pptx` you can upload as an artifact, attach to a release, or mail out.
Your numbers bind **verbatim** — there's no model in the render path, so the same input always produces
the same deck.

```yaml
- uses: smartdatabrokers/slideforge-deck-action@v1
  with:
    api-key: ${{ secrets.SLIDEFORGE_API_KEY }}
    deck: examples/deck.json
    output: weekly-report.pptx
```

## Get a key (free, ~30 seconds)

[**Sign up**](https://slideforge.dev/sign-up) → **60 free slides, no credit card, no subscription** →
copy your key from [**console/keys**](https://slideforge.dev/console/keys) and save it as a repo secret
(`Settings → Secrets and variables → Actions`). A render that isn't usable
[never bills](https://slideforge.dev/pricing).

## The deck file

Either an envelope or a bare array of slide intents:

```json
{
  "name": "Weekly report",
  "slides": [
    { "form": "kpi_metrics", "headline": "Q3 at a glance",
      "data": { "metrics": [
        { "label": "Revenue", "value": "$12.4M", "delta": "+18% YoY" },
        { "label": "New clients", "value": "847" },
        { "label": "NPS", "value": "62" } ] } },
    { "form": "hero_statement", "headline": "Rendered in CI" }
  ]
}
```

Pick a `form` (150+ layouts: KPI boards, waterfalls, Gantt, org charts, funnels…) and put your real
content in its typed fields. Browse every form and its exact payload schema at
[slideforge.dev/templates](https://slideforge.dev/templates) — or generate the JSON from your own data
in a previous step (that's the point: the numbers come from your pipeline, not from a model).

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | ✅ | — | Your SlideForge key. Use a repo secret. |
| `deck` | | `deck.json` | Path to the JSON file of slide intents. |
| `output` | | `deck.pptx` | Where to write the `.pptx`. |
| `theme-id` | | — | Built-in theme or your uploaded brand template. |
| `name` | | — | Deck name (overrides `name` in the file). |
| `fail-on-warnings` | | `false` | Fail on non-blocking warnings too (blocking errors always fail). |
| `api-base` | | `https://api.slideforge.dev` | Only change for testing. |

## Outputs

| Output | Description |
|---|---|
| `job-id` | SlideForge job id. |
| `pptx-path` | Path to the written file. |
| `status` | `complete` · `completed_with_errors` · `rejected`. |
| `fidelity` | `verbatim` · `mixed` · `ai_completed` — how your content was bound. |
| `slides` | Slides rendered. |
| `cost` | USD charged (`0` when nothing usable was produced). |

## Full example — weekly deck, every Monday

```yaml
name: Weekly deck
on:
  schedule: [{ cron: "0 7 * * 1" }]
  workflow_dispatch:

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Build deck.json from your own data however you like.
      # - run: python scripts/build_deck.py > deck.json

      - id: deck
        uses: smartdatabrokers/slideforge-deck-action@v1
        with:
          api-key: ${{ secrets.SLIDEFORGE_API_KEY }}
          deck: deck.json
          output: weekly-report.pptx

      - uses: actions/upload-artifact@v4
        with:
          name: weekly-report
          path: ${{ steps.deck.outputs.pptx-path }}

      - run: echo "Rendered ${{ steps.deck.outputs.slides }} slides (${{ steps.deck.outputs.fidelity }})"
```

## How failures behave

The step's exit code follows SlideForge's honesty layer, so CI tells you the truth:

- **Blocking errors / no usable deck →** the step fails, and **nothing is billed**. The error names what
  went wrong (e.g. a form given too few data points).
- **Non-blocking warnings →** logged as `::warning::` and the deck still renders. Set
  `fail-on-warnings: true` to treat them as failures.
- Every run writes a **job summary** with status, fidelity, warnings, cost, and the job id.

> An **invalid key** can surface as `402 Insufficient balance` rather than `401` — if you just set the
> secret up, check it before assuming you're out of credit.

## Notes

- Zero dependencies (Node 20+ built-in `fetch`) — nothing to audit or bundle.
- Prefer calling the API yourself? It's one POST: [REST docs](https://slideforge.dev/docs/api).
  Using agents? SlideForge is also an MCP server — see
  [smartdatabrokers/slideforge-mcp](https://github.com/smartdatabrokers/slideforge-mcp).
- **SlideForge** by [Smart Data Brokers GmbH](https://slideforge.dev) · MIT.
