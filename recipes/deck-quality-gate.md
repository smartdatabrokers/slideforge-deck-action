# Recipe — a quality gate for decks you already generate

**The problem:** a generated deck can rot quietly. Someone renames a column, a metric goes null, a list
grows past what the layout holds — and the deck still "builds", just wrong. Nobody notices until it's on
a screen in front of a customer.

**The fix:** treat decks like any other build output. The action's exit code follows SlideForge's
honesty layer, so a deck that no longer renders faithfully **fails CI instead of shipping quietly** —
and a refused render isn't billed, so the gate is free to run.

No screenshot for this one: the deliverable is a red X.

## What the gate actually checks

Every render reports what happened, and the action maps it to an exit code:

| Result | Action behaviour |
|---|---|
| Usable deck, no issues | ✅ passes, writes the `.pptx` |
| **Blocking errors / nothing usable** | ❌ **fails**, names the cause, **nothing billed** |
| Non-blocking warnings (e.g. tight fit) | ⚠️ `::warning::`, still passes — unless `fail-on-warnings: true` |

`fidelity` is the other half: `verbatim` means every supplied value landed as given. If it comes back
`mixed` or `ai_completed`, something was filled in that you didn't supply — worth failing on for a deck
that carries real numbers.

## The workflow

```yaml
name: Deck quality gate
on:
  pull_request:
    paths: ["data/**", "scripts/build_*_deck.py", "templates/**"]
  schedule: [{ cron: "0 6 * * *" }]     # catch upstream data drift too

jobs:
  gate:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        deck: [weekly-metrics, analytics-review, release-notes]
    steps:
      - uses: actions/checkout@v4

      - run: python scripts/build_${{ matrix.deck }}_deck.py > ${{ matrix.deck }}.json

      - id: render
        uses: smartdatabrokers/slideforge-deck-action@v1
        with:
          api-key: ${{ secrets.SLIDEFORGE_API_KEY }}
          deck: ${{ matrix.deck }}.json
          output: ${{ matrix.deck }}.pptx
          fail-on-warnings: true

      - name: Require verbatim binding
        if: ${{ steps.render.outputs.fidelity != 'verbatim' }}
        run: |
          echo "::error::fidelity=${{ steps.render.outputs.fidelity }} — something was filled in that we didn't supply."
          exit 1
```

The matrix means one broken deck doesn't hide the others (`fail-fast: false`), and each gets its own
line in the checks list.

## Cheaper: validate without rendering

If you only want to know *"would this deck render?"*, the API validates a payload at **$0** — no render,
no charge. Useful on every PR, with the paid render reserved for the scheduled run:

```yaml
      - name: Validate only (free)
        run: |
          curl -sS -X POST https://api.slideforge.dev/v1/render/intent/deck \
            -H "Authorization: Bearer ${{ secrets.SLIDEFORGE_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d "$(jq '. + {dry_run: true}' deck.json)" \
          | jq -e '.status == "complete"' > /dev/null
```

`dry_run` returns a per-slide validation manifest (which slide, which field, what's wrong) so a failing
check tells you *where* to look.

## What tends to break in practice

- **A list outgrew its layout.** Forms have capacity; supplying 12 items to a form that holds 6 is a
  blocking error rather than a silent drop — that's the behaviour you want, but it *will* fail the
  build the first time a query returns more rows than usual.
- **A metric went null** and the generator emitted `"value": "None"`.
- **An upstream rename** emptied a field, so the slide renders with a heading and nothing under it.

All three are the kind of thing that reaches a customer unnoticed without a gate — and all three are
caught by a check that costs nothing when it fails.
