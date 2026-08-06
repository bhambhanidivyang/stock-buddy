# Stock picking flow

End-to-end recommendation pipeline: NSE universe → PENDING plan.

**Orchestrator:** `RecommendationsService.createRecommendation` → `MarketFeatureEngine.buildBoard` → AI → `normalizePicks`.

## Hard rule

AI never invents buy / stop / target. It copies `suggestedLevels`. The service and pick-validator overwrite prices from the engine again before persist.

## Pipeline stages

| # | Stage | What happens | Gates (env) |
|---|--------|--------------|-------------|
| 1 | Entry | `POST /recommendations`, IST scheduler 08:45, or manual job | `REC_MAX_PER_DAY` (IST); paper account for user |
| 2 | Universe | NSE EQ master from DB (`EQUITY_L`); soft-sync + bhav ADTV map | Prior `nse_sync` (18:30 IST) preferred |
| 3 | Liquidity filter | Drop bhav/live price below min; ADTV below min over lookback | `REC_MIN_PRICE`, `REC_MIN_ADTV`, `REC_ADTV_LOOKBACK` |
| 4a | **Research Ranking** (default) | Regime → sector RS rank → leader pool → research score → Top K | `REC_SHORTLIST_MODE=ranking`, `RANK_*` |
| 4b | Activity shortlist (legacy) | Score \|change\|, \|gap\|, RVOL; take top N | `REC_SHORTLIST_MODE=activity`, `REC_PRIORITY_*` |
| 5 | Deep features + setups | Yahoo history → indicators → `STRUCTURE_ATR_V1` trade plan | `REC_MIN_HISTORY` + all `LVL_*` knobs |
| 6 | Buyable split | `VALID` tradePlan → BUYABLE; else REJECTED with code | `suggestedLevels` only when VALID |
| 7 | Cash gate | If `availableCash` < min deploy → skip AI, empty new buys | `REC_MIN_DEPLOY_CASH_INR` |
| 8 | AI portfolio | PM-style select from BUYABLE; copy levels; size book | `OPENAI_*`; researchScore in context |
| 9 | Validate + deploy | Force engine prices; sector/alloc/RR; full-cash top-up | `REC_MAX_PER_SECTOR`, alloc + leftover caps, `REC_FULL_CASH_DEPLOY` |
| 10 | Persist → UI | PENDING run + items; funnel + setup rejects returned | `PATCH` edits while PENDING only |

## Funnel shape (ranking mode)

```
~2000+ NSE EQ
  → liquid (price + ADTV)
  → quotes OK
  → market regime (risk dial; No-trade skip OFF by default)
  → top S sectors by RS vs equal-weight liquid market
  → sector leader pool (~S×M) + hybrid wildcards
  → research score → Top RANK_TOP_K (40)
  → BUYABLE (VALID trade plan)
  → AI portfolio picks (if cash ≥ min deploy)
  → validator kept
  → PENDING plan → UI
```

## Research Ranking (what it answers)

> Which stocks have the highest probability of outperforming the average liquid NSE stock over the next 1–5 sessions?

**Not** entry. **Not** AI conviction. Factors: Relative Strength, Trend Quality, Near 52w High, Momentum Persistence, Sector Leadership, Volume Confirmation. Event weight = 0 in v1.

See `docs/RESEARCH-RANKING-ENGINE.md` for formulas and weights.

**Removed from research shortlist:** today’s % change, today’s gap, today’s RVOL (legacy activity only).

## Buyable

A shortlisted name is **BUYABLE** only if RSI / EMA50 / ATR exist and `tradePlan.validationStatus === 'VALID'` (`suggestedLevels` present). All other shortlist names are **REJECTED** with a structured code — independent of cash.

Cash only gates whether AI is called for new buys (`skipNewBuysReason: LOW_CASH`).

## Setup priority (first match wins)

Thresholds from env (`LVL_*`). Detection uses **last completed close**, not LTP.

1. **BREAKOUT_RETEST** — Prior Donchian close-break (age 1…lookback); close in retest band; touched R; ADX ≥ min  
2. **BREAKOUT_FRESH** — Close > prior N-day high close; RVOL ≥ min; ADX ≥ min; extension ≤ max ATR  
3. **PULLBACK_EMA20** — EMA20 > EMA50; ADX ≥ min; touched EMA20; close in pullback band  
4. **PULLBACK_PDH** — EMA20 > EMA50; ADX ≥ min; PDH broken in lookback; close retesting PDH band  

## Who does what

| Role | Owns |
|------|------|
| **Research Ranking** (deterministic) | Regime, sector flow, research score, Top K |
| **Engine** (deterministic) | Liquidity, indicators, four setups, entry/stop/target, RR ≥ min at buyHigh |
| **AI** (portfolio manager) | Regime style, which BUYABLE combo, qty/allocation/conviction, summaries — levels copied as facts |
| **Validator** (enforce) | Force engine prices, sector/alloc caps, cash trim, full-cash deploy until leftover dust |

## Common exits

| Code / reason | When |
|---------------|------|
| `NO_SETUP` | None of the four setups matched |
| `ENTRY_EXTENDED` / `ENTRY_MISSED` | LTP outside entry band + chase/miss ATR |
| `STOP_*` / `TARGET_*` | No structure, stop too wide, target bad/horizon |
| `RR_TOO_LOW` | Reward/risk at buyHigh &lt; `LVL_MIN_TARGET_RR` |
| `LOW_CASH` | `availableCash` &lt; `REC_MIN_DEPLOY_CASH_INR` (skip AI) |
| Validator drops | Unknown symbol, stale band, sector/alloc/cash fail |

**Live position management (design):** after fill, OPEN lots are managed by a deterministic Position Review Engine (NORMAL → PROTECTED → TRAILING). Target is an expected profit **zone**, not a hard sell. See [`docs/POSITION-REVIEW-ENGINE.md`](./POSITION-REVIEW-ENGINE.md) (design — not implemented until approved).

## Key files

- `docs/RESEARCH-RANKING-ENGINE.md` — ranking design (frozen)
- `docs/POSITION-REVIEW-ENGINE.md` — open-position management design
- `backend/src/config/ranking.config.ts`
- `backend/src/market/ranking/research-ranking.engine.ts`
- `backend/src/recommendations/recommendations.service.ts`
- `backend/src/market/features/market-feature.engine.ts`
- `backend/src/market/features/research-prioritizer.ts` — legacy activity mode
- `backend/src/market/levels/setup.engine.ts`
- `backend/src/market/levels/trade-plan.engine.ts`
- `backend/src/ai/openai.service.ts`
- `backend/src/recommendations/pick-validator.ts`
- `backend/src/config/recommendation.config.ts`
- `backend/src/market/levels/levels.config.ts`
