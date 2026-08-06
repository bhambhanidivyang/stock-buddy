# Position Review Engine — Design

**Status:** Design only — no implementation until approved  
**Horizon:** 1–5 trading session swing (NSE cash)  
**Objective (freeze this):**  
Consistently **protect profits** and **exit trades whose original thesis has broken** — not predict the perfect exit price.

This is a **deterministic Position Manager** for OPEN lots.  
It is **not** an entry engine, **not** an AI exit brain, and **not** an intraday scalper.

**Priority note:** Ship this until it is *good enough*, then **freeze** it. Long-term edge belongs in [Research Ranking](./RESEARCH-RANKING-ENGINE.md) (better entries), not endless exit tuning.

---

## 0. Why change

### Current behavior

| Mechanism | Today |
|-----------|--------|
| Hard exits | Poll: `price ≥ sellTarget` → sell; `price ≤ stopLoss` → sell |
| Trail / time-stop | Only when `POST /recommendations` runs (`ManageHoldingsService`) |
| EOD | Green → sell; flat/red → `NEEDS_REVIEW` (human) |

### Failure mode

Many names reach **+2–3%**, never print the rigid target, then reverse into losers. Blind trailing everything causes premature noise exits. Parking large share of lots in `NEEDS_REVIEW` means the “deterministic” system is incomplete.

### Target behavior

```text
Buy → Manage → Protect → Trail → Exit
```

`expectedTargetZone` is an **expected profit zone**, not “sell exactly here.”

---

## 1. Non-goals

- No AI for normal reviews or price invention  
- No MACD (or other lagging oscillators) in exit decisions  
- No intraday scalp logic; daily structure + ATR dominate  
- No endless config sprawl — lean ladder, few knobs  
- Do not keep refining exits after v1 is backtested and stable  

---

## 2. State machine

Persist **`managementPhase`** on the trade while DB `status` remains `OPEN` (until exit or rare human review).

```text
fillBuy
   ↓
NORMAL  ──(+1R)──►  PROTECTED  ──(+2R)──►  TRAILING  ──►  SELL → CLOSED
   │                    │                     │
   └──────── Trend / Time / Stop ─────────────┘
                      │
                      ▼
              NEEDS_REVIEW  (exceptional <1%)
                      │
              Hold → resume phase / Sell → CLOSED
```

| Phase | Meaning |
|-------|---------|
| **NORMAL** | Initial stop only; thesis still on initial risk |
| **PROTECTED** | Unrealized ≥ **+1R**; stop ≥ break-even |
| **TRAILING** | Unrealized ≥ **+2R** (or zone-touch while already protected); stop trails HWM / structure; only rises |
| **SELL** | Market exit (paper mark) |
| **NEEDS_REVIEW** | Ops / data failure only — not the default EOD path |

**Within PROTECTED (not a fourth phase):** at **+1.5R**, raise stop to lock at least **+0.5R** (`buy + 0.5 × R`).

---

## 3. Persisted fields (required)

On every OPEN lot the engine owns:

| Field | Role |
|-------|------|
| `managementPhase` | `NORMAL` \| `PROTECTED` \| `TRAILING` |
| `initialStop` | Stop at fill (immutable for R) |
| `R` | `buyPrice − initialStop` (> 0) |
| `stopLoss` | Working stop (never lowers) |
| `expectedTargetZone` | Soft profit zone upper bound (was hard `sellTarget`) |
| `zoneExtendedOnce` | Boolean; at most one extension |
| `highWaterMark` | `max` price seen since fill |
| `maxUnrealizedR` | `max((price − buy) / R)` since fill |
| `lastReviewAt` / `lastReviewEvent` | Debounce + audit |

**Update on every poll quote (cheap, no full review):**

```text
highWaterMark   = max(highWaterMark, price)
maxUnrealizedR  = max(maxUnrealizedR, (price − buyPrice) / R)
```

**Giveback (R-space from peak):**

```text
peakR     = (highWaterMark − buyPrice) / R
currentR  = (price − buyPrice) / R
givebackR = peakR − currentR
```

Without HWM / maxUnrealizedR, profit protection and giveback exits are not backtestable.

---

## 4. Review cadence

### Hard path (always on)

Existing execution poll (`POLL_INTERVAL_MS`):

- **`price ≤ stopLoss` → SELL** (reason `STOP`)
- **Do not** auto-sell solely because `price ≥ expectedTargetZone`

Fast, no indicator rebuild.

### Soft path — exactly three event categories

Full review (indicators + ladder) runs only when one category fires, with debounce (`REV_EVENT_DEBOUNCE_MIN`, default **15** minutes) so the same lot is not reviewed dozens of times per session.

| Category | Fires when |
|----------|------------|
| **Profit Event** | `maxUnrealizedR` crosses **1.0 / 1.5 / 2.0**; or price enters expected zone; or giveback from HWM exceeds trail giveback rule while PROTECTED/TRAILING |
| **Trend Event** | Structure break (below active swing low); or daily close below EMA20 with ADX weakening; or RS / sector collapse vs entry context |
| **Time Event** | New IST session / holding-day boundary; max hold sessions reached; EOD force window |

**Not separate trigger types:** raw “price moved 0.5 ATR”, MACD cross, regime tick alone, etc. ATR/price are **inputs inside** Profit/Trend rules.

### Why not 5-minute full reviews

Swing thesis lives on **daily** structure. Rebuilding EMA/ADX/RS every 5 minutes burns quote budget and creates review spam. The hard poll already protects the stop. **Event-driven + 15m debounce** scales and stays explainable.

| Cadence | Verdict |
|---------|---------|
| Every 5 min full review | Reject — noise + cost |
| Every 10 min full review | Reject — still chatty |
| Every 15 min only | Acceptable as **debounce**, not sole driver |
| Pure event, no debounce | Risk of burst reviews on volatile prints |
| **Hybrid: 3 events + 15m debounce** | **Frozen** |

---

## 5. Inputs (lean)

Allowed for soft review:

- Current price, unrealized P/L %, current R  
- Daily OHLC (and prior completed bars)  
- EMA20, EMA50 (EMA200 optional context only)  
- ATR  
- ADX  
- Relative strength vs Nifty / liquid universe  
- Sector strength  
- Market regime (context; not a hard skip by default)  
- Holding sessions (IST weekdays since `buyAt`)  
- Swing structure (existing structure engine)  
- Volume vs average  
- **highWaterMark**, **maxUnrealizedR**

**Excluded:** MACD, AI scores, discretionary text.

Reuse ranking / levels market stack and IST caches where possible.

---

## 6. One profit ladder

```text
Buy
  R = buyPrice − initialStop
     │
     ├─ maxUnrealizedR ≥ 1.0  → phase = PROTECTED
     │                          stopLoss = max(stopLoss, buyPrice)   // break-even
     │
     ├─ maxUnrealizedR ≥ 1.5  → stopLoss = max(stopLoss, buyPrice + 0.5×R)
     │
     ├─ maxUnrealizedR ≥ 2.0  → phase = TRAILING
     │                          begin trail (below)
     │
     └─ Exit via stop / trend / time / giveback
```

**Rules:**

- Never lower `stopLoss`.  
- Phase only advances (NORMAL → PROTECTED → TRAILING).  
- Flat **%** break-even (e.g. “+2% then BE”) is **rejected** as primary rule: on a ₹2500 name with large ATR, +2% can be noise; with tiny ATR, +2% can be late. **R** is the unit.

### Trail formula (TRAILING only)

```text
structureStop = lastSwingLow − LVL_STOP_ATR_BUFFER × ATR     // existing structure trail idea
chandelier    = highWaterMark − REV_TRAIL_ATR × ATR
stopLoss      = max(stopLoss, structureStop, chandelier)
```

Optional EMA breath: if close still above EMA20, do not use EMA as a *tighter* stop than chandelier/structure (avoid double-chop). EMA20 is primarily a **Trend Event** exit input, not a third competing trail by default.

### Giveback exit (TRAILING)

```text
if managementPhase === TRAILING
   and givebackR ≥ REV_GIVEBACK_ATR × (ATR / R)   // or equivalently price ≤ HWM − REV_GIVEBACK_ATR×ATR
→ SELL_MARKET (reason REVIEW_GIVEBACK)
```

(Exact equivalent forms must match in code; pick price form for clarity: `price ≤ highWaterMark − REV_GIVEBACK_ATR × ATR`.)

---

## 7. HOLD vs SELL_MARKET (deterministic)

Soft review returns **`HOLD`** or **`SELL_MARKET`**. On HOLD, may update stop / phase / zone (within rules). AI never invents prices.

### SELL_MARKET when (first match)

1. **Hard stop** (poll) — already exited; review no-ops  
2. **Trend — structure:** `price < activeSwingLow` (thesis invalid)  
3. **Trend — EMA + ADX:** prior daily close `< EMA20` **and** ADX declining vs prior bar (or ADX `< REV_ADX_MIN` if we keep one threshold — prefer: ADX_t < ADX_{t−1})  
4. **Trend — RS collapse (optional soft):** stock RS vs Nifty over review window deeply negative while Nifty flat/up — document as secondary; primary exits are structure + EMA  
5. **Time — max hold:** `sessionsHeld ≥ REV_MAX_HOLD_SESSIONS` **and** (`phase === NORMAL` **or** `price < expectedTargetZone`)  
6. **Time — EOD force (deterministic):** see §8 — prefer auto sell over park  
7. **Profit — giveback** while TRAILING (§6)

### HOLD when

None of the above. Then apply ladder upgrades and trail raise.

---

## 8. Time management

| Sessions held | Behavior |
|---------------|----------|
| 1–2 | Normal ladder; give trade room |
| 3+ | Prefer tighter effective trail (same formulas; HWM/ATR naturally tighten) |
| ≥ `REV_MAX_HOLD_SESSIONS` (default = `LVL_MAX_HOLD_SESSIONS`, e.g. 5) | **Time Event:** if still NORMAL or below zone → `SELL_MARKET`; if TRAILING with locked profit → allow one more session **or** sell — **freeze default: SELL_MARKET** for simplicity |

EOD (replace “park losers” as default):

| Situation at EOD window | Action |
|-------------------------|--------|
| PROTECTED or TRAILING | Hold overnight; stop already protecting |
| NORMAL, day ≥ 2, below BE | `SELL_MARKET` (cut stagnant) **or** hold one more day — **freeze default: SELL if sessionsHeld ≥ 2 and still NORMAL** |
| No quote / data integrity | `NEEDS_REVIEW` only |

Success bar: **&lt;1%** of fills ever enter `NEEDS_REVIEW`.

---

## 9. Target / zone management

### Semantics

`expectedTargetZone` (UI may still show “Target”) = **expected profit zone**, not a market order.

Entering the zone = **Profit Event** → ensure at least PROTECTED / lock rules fire; **do not** auto-sell solely on zone touch.

### Extension (at most once)

```text
if !zoneExtendedOnce
   and phase ∈ {PROTECTED, TRAILING}
   and price ≥ expectedTargetZone − smallBuffer   // in/near zone
   and nextResistance = nearest structure resistance above price
   and nextResistance ≥ buyPrice + 1.5 × R        // still meaningful
→ expectedTargetZone = nextResistance
   zoneExtendedOnce = true
else
→ never raise zone again; trail only
```

**Forbidden:** repeatedly lifting zone (100 → 104 → 108…) as price approaches. That moves the goalposts and defeats profit protection.

---

## 10. Configuration (lean)

Feature flag: `REV_ENGINE_ENABLED` (default off until rollout).

| Env | Default | Meaning |
|-----|---------|---------|
| `REV_ENGINE_ENABLED` | `false` | Master switch |
| `REV_BE_R` | `1.0` | PROTECTED gate (break-even) |
| `REV_LOCK_R` | `1.5` | Lock-profit gate |
| `REV_LOCK_FLOOR_R` | `0.5` | Stop ≥ buy + this × R at lock gate |
| `REV_TRAIL_R` | `2.0` | TRAILING gate |
| `REV_TRAIL_ATR` | `1.5` | Chandelier distance from HWM |
| `REV_GIVEBACK_ATR` | `1.0` | Exit if price ≤ HWM − this × ATR while TRAILING |
| `REV_MAX_HOLD_SESSIONS` | reuse `LVL_MAX_HOLD_SESSIONS` | Time stop |
| `REV_EVENT_DEBOUNCE_MIN` | `15` | Min minutes between soft reviews per trade |

**Fixed in code (not env):** zone extend at most once; no MACD; hard target sell off when engine on; phase only advances.

Reuse: `LVL_STOP_ATR_BUFFER`, structure swing knobs, poll interval.

**Rejected knobs (do not add):** separate zone RR/ATR mult sprawl, MACD gates, many overlapping R arms, per-indicator review intervals.

---

## 11. Interaction with existing systems

```text
[Research Ranking + Trade Plan] → entry band, initialStop, expectedTargetZone
        ↓
[Execution poll] → stop fills only (when REV on); update HWM / maxUnrealizedR
        ↓
[Position Review Engine] → Profit / Trend / Time → HOLD (ladder) or SELL_MARKET
        ↓
[NEEDS_REVIEW] → exceptional → Portfolio Sell / Hold
```

| Component | Change when engine ON |
|-----------|------------------------|
| `ExecutionLoopService.processExits` | Stop-only hard sell; remove target auto-sell |
| `ManageHoldingsService` on recommend | Fold into review engine / stop duplicating trail-only-on-recommend |
| EOD settlement | Deterministic auto exits (§8); rare park |
| Portfolio UI | “Zone” language; Sell / Hold still for exceptional review |
| API `sellTarget` field | Keep name for compat; document as expected zone |

Exit reasons (add): `REVIEW_TREND`, `REVIEW_TIME`, `REVIEW_GIVEBACK`; keep `STOP`, `HUMAN_SELL`, trim use of park-only paths.

---

## 12. Observability and backtest

Each soft review audit row:

```text
{ tradeId, ts, eventCategory, action, phaseBefore, phaseAfter,
  price, highWaterMark, maxUnrealizedR, givebackR,
  oldStop, newStop, oldZone, newZone, zoneExtendedOnce,
  reasons[], inputsHash }
```

**Backtest metrics:**

- Giveback after reaching +1R / +2R  
- % exits by STOP vs REVIEW_* vs HUMAN  
- % lots touching `NEEDS_REVIEW` (target &lt;1%)  
- Avg hold sessions; win rate; expectancy  

Replay must use only deterministic inputs (no AI).

---

## 13. Challenge log

| Idea | Verdict |
|------|---------|
| Hard sell at `sellTarget` | **Reject** as primary — causes giveback after soft highs |
| Flat +2% → break-even | **Reject** as primary — use R ladder; % ignores ATR |
| UNDER_MANAGEMENT abstract state | **Reject** — use NORMAL / PROTECTED / TRAILING |
| MACD in exits | **Reject** — lag; EMA + ADX + structure enough |
| Many R / zone env knobs | **Reject** — debug hell |
| Unlimited zone raises | **Reject** — one extension max |
| Frequent `NEEDS_REVIEW` | **Reject** — engine incomplete if common |
| 5-min full indicator review | **Reject** — cost / spam |
| Endless PM refinement | **Reject** — freeze and invest in ranking |

---

## 14. Success criteria

The engine must:

- Protect profits via BE → lock → trail  
- Avoid stale hard targets  
- Avoid unnecessary AI  
- Be deterministic, explainable, backtestable  
- Execute quickly (hard poll cheap; soft review rare)  
- Drive `NEEDS_REVIEW` toward **&lt;1%** of trades  
- Be freezable so research ranking stays the main R&D surface  

---

## 15. Frozen decisions checklist

1. States: **NORMAL → PROTECTED → TRAILING → SELL**  
2. Ladder: **+1R BE, +1.5R lock 0.5R, +2R trail**  
3. Events: **Profit / Trend / Time** only (+ 15m debounce)  
4. Hard poll: **stop only** (no zone market sell)  
5. **HWM + maxUnrealizedR** persisted  
6. Zone: soft; **one extension max**; then trail only  
7. **No MACD**  
8. Lean **~8** env knobs + flag  
9. **NEEDS_REVIEW** exceptional  
10. After v1: **freeze PM**, prioritize **Research Ranking**  

---

## 16. Rollout (after approval — not this doc’s implementation)

1. Flag off by default; shadow-log reviews without changing fills  
2. Enable stop-only + ladder on paper  
3. Compare giveback / NEEDS_REVIEW rate vs baseline  
4. UI copy: zone vs “sell here”  
5. Freeze config; return bandwidth to ranking  

---

## Related

- [STOCK-PICKING-FLOW.md](./STOCK-PICKING-FLOW.md) — entry pipeline  
- [RESEARCH-RANKING-ENGINE.md](./RESEARCH-RANKING-ENGINE.md) — where long-term edge should compound  
- Today’s loop: `backend/src/execute/execution-loop.service.ts`  
- Today’s occasional trail: `backend/src/recommendations/manage-holdings.service.ts`
