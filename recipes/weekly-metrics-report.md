# Recipe — the weekly metrics report

**The problem:** someone rebuilds the same 15-slide report every Monday from the same queries. It's
hours of copy-paste, and every retyped number is a chance to be wrong.

**The fix:** a cron workflow reads your metrics, writes `deck.json`, and the action renders it. The
numbers land on the slide exactly as your query returned them.

![Weekly metrics deck rendered by the action](images/weekly-metrics.png)

*Rendered from [`examples/weekly-metrics.json`](../examples/weekly-metrics.json) — cover, KPI board,
trend, and a RAG workstream table. 4 slides, $0.20.*

## The workflow

```yaml
name: Weekly metrics
on:
  schedule: [{ cron: "0 7 * * 1" }]   # Mondays 07:00 UTC
  workflow_dispatch:

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Pull metrics and build the deck
        env:
          WAREHOUSE_URL: ${{ secrets.WAREHOUSE_URL }}
        run: python scripts/build_weekly_deck.py > deck.json

      - id: deck
        uses: smartdatabrokers/slideforge-deck-action@v1
        with:
          api-key: ${{ secrets.SLIDEFORGE_API_KEY }}
          deck: deck.json
          output: weekly-metrics.pptx

      - uses: actions/upload-artifact@v4
        with:
          name: weekly-metrics
          path: ${{ steps.deck.outputs.pptx-path }}
```

## The generator step

This is the only part you write. It maps query results onto slide forms:

```python
# scripts/build_weekly_deck.py
import json, datetime

kpis   = fetch_kpis()          # your warehouse / API / CSV
trend  = fetch_active_teams()
streams = fetch_workstreams()

deck = {
    "name": f"Weekly metrics — week {datetime.date.today().isocalendar().week}",
    "slides": [
        {"form": "hero_statement", "headline": "Weekly Metrics",
         "context": "Automatically rendered from the metrics warehouse",
         "date": datetime.date.today().isoformat()},

        {"form": "kpi_metrics", "headline": kpis["headline"], "context": "This week vs last",
         "data": {"metrics": [
             {"label": k["label"], "value": k["value"], "delta": k["delta"]} for k in kpis["cards"]
         ]},
         "takeaway": kpis["takeaway"]},

        {"form": "trend_chart", "headline": "Weekly active teams keep compounding",
         "context": "Weekly active teams",
         "data": {"periods": trend["weeks"],
                  "series": [{"label": "Active teams", "values": trend["values"], "emphasis": "primary"}],
                  "target": {"value": 1100, "label": "Q3 target 1,100"}},
         "source_note": "Warehouse snapshot, Monday 06:00 UTC"},

        {"form": "status_dashboard", "headline": "Workstreams needing a decision",
         "context": "Delivery workstreams",
         "data": {"rows": [
             {"item": s["name"], "status": s["rag"], "progress": s["pct"],
              "owner": s["owner"], "due": s["due"], "next_action": s["next"]} for s in streams
         ]}},
    ],
}
print(json.dumps(deck))
```

**Write the headline, not just the number.** `"Signups held, activation improved"` is worth more than
`"Weekly KPIs"` — and since you're generating it, you can compute the sentence from the data
(`"up" if delta > 0 else "down"`).

## Getting it to people

The artifact is fine for a team that lives in GitHub. Otherwise chain a step:

```yaml
      # Slack
      - run: |
          curl -F file=@weekly-metrics.pptx -F channels=$SLACK_CHANNEL \
               -H "Authorization: Bearer $SLACK_TOKEN" https://slack.com/api/files.upload
      # or email, SharePoint, Drive, S3 — it's just a file
```

## Notes

- **Cost:** slides × $0.05. A 15-slide weekly report is $0.75/week.
- **Empty weeks:** if a query returns nothing, don't emit a slide with placeholders — skip it. A short
  honest deck beats a padded one, and `kpi_metrics` with fabricated zeros is worse than no slide.
- **Brand it once:** upload your company template
  ([`upload_asset(purpose='theme')`](https://slideforge.dev/docs/mcp)) and pass `theme-id` — every
  week's deck then renders on your own master.
- If a metric is missing and you'd have to guess it, leave it out. The whole point of `fidelity:
  verbatim` is that nobody has to wonder whether a number on the slide is real.
