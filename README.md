# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/morenoo-del/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/morenoo-del/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. It reads a sealed snapshot of every protocol DefiLlama tracks, works out which ones still record no token and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth; then hands in a web dashboard that shows the board, a detail view for each protocol and the steps to farm it.

## The model

Implied value = TVL × category multiple × growth factor × maturity factor × spread factor.

- **Category multiple** — the median market-cap / TVL of the live-token protocols in the same category (thin categories fall back to the market median). A lending protocol is priced like lending protocols trade.
- **Growth factor** — 1 + clamped 7-day TVL change × 0.6.
- **Maturity factor** — 0.70 → 1.00 over four years tracked with no token.
- **Spread factor** — +3% per extra chain, up to four.

No protocol name is special-cased; the same formula scores every row. Protocols whose token already trades are shown apart, at the market's own value, never ranked against the pre-token board. On this snapshot the board holds 178 rows: the 40 watchlist protocols plus 138 early finds below the $50M floor.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to `board.json`, the dashboard's data to `data.js`, copies `dashboard/` and `screenshots/` to the output, and writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=w6xj1ecj&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
