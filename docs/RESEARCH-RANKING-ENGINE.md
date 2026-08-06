# Research Ranking Engine — Design (v2)

**Status:** Implemented (v1) — `REC_SHORTLIST_MODE=ranking`  
**Objective function (freeze this):**  
Maximize the probability that the **Top 40** contains stocks that **outperform the average liquid NSE stock over the next 1–5 sessions**.

This is **not** an entry engine, **not** an AI score, and **not** a portfolio constructor.

---

## 0. Challenges to the proposed framework

Your hierarchy is directionally right. Below is where I would push back before freezing formulas.

### Challenge 1 — “Ignore IT because it’s −2” is absolute, not relative

If Nifty is −4% over 20d and IT is −2%, **money is relatively flowing into IT**. Sector rank must be **RS vs Nifty** (and ideally vs equal-weight market), not raw sector return.

**Rule:** never drop a sector on absolute return alone.

### Challenge 2 — Sector gate can over-concentrate and miss idiosyncratic winners

Hard-excluding all non-leading sectors is powerful (industry momentum is real) and also the largest **false-negative** risk in your design: a lone leader in a flat sector can still outperform for 5 days.

**Proposed compromise (testable):**

| Mode | Behavior |
|------|----------|
| **A — Strict (your default)** | Only stocks in top *S* sectors enter the research pool |
| **B — Soft** | All liquid names scored; sector rank is a large weight only |
| **C — Hybrid (recommended v1)** | ≥80% of Top 40 from top *S* sectors; ≤20% “wildcard” seats for exceptional RS/52w names outside |

Backtest A vs C on 5d excess hit-rate of Top 40. Freeze the winner.

### Challenge 3 — “Sector Leaders” then “Research Score” can be redundant

If Stage 4 already includes RS, trend, 52w, volume, persistence, and sector leadership, Stage 3 should be a **hard eligibility gate + pool sizing**, not a second opinionated ranker with different factors.

**Clean split:**

- Stages 1–3 → **where capital is allowed to play** (regime + sector + optional per-sector cap)  
- Stage 4 → **who is strongest inside that playground** (one research score)  
- Stages 6–7 → **where/when to buy** (setup + plan)  
- Stage 8 → **which combination to hold** (AI PM)

Do **not** put earnings/news in Stage 3 unless the same signals are deterministic in Stage 4. News is not reproducible; it breaks backtests.

### Challenge 4 — Market regime “No-trade” will be wrong often if thresholds are vibes

Regime is valuable as a **risk dial** (position size, max names, factor tilt). As a hard kill-switch it needs evidence. Many profitable 5d winners occur on “ugly” breadth days.

**Recommended:** regime changes *behavior*, not existence of research:

| Regime | Research | Setup | AI deploy |
|--------|----------|-------|-----------|
| Aggressive | Top 40 | normal | full cash rules |
| Balanced | Top 40 | normal | normal |
| Defensive | Top 40 but prefer higher trend/52w quality | stricter ADX/setup | fewer names / lower gross |
| No-trade | Still compute Top 40 for audit | skip new entries | skip AI new buys |

Only promote No-trade → hard skip after backtest shows negative expectancy for *new longs* in that bucket.

### Challenge 5 — “Accumulation” without delivery % is a proxy, not truth

Multiple high-volume up days + low-volume pullbacks is a good **price-volume proxy**. In India, **delivery %** is closer to institutional intent. Until delivery is in the pipeline, call the factor **Volume Confirmation**, not Accumulation — honesty in naming prevents false confidence.

### Challenge 6 — Your weight list doesn’t yet sum / allocate “Huge” 52w

You marked near-52w as huge but didn’t assign %. Below freezes a coherent book that matches your intent (RS first, persistence over spikes, kill today’s %/gap/RVOL from research).

### Challenge 7 — Breadth of what?

“Advance/Decline” and “sector breadth” on the **BUYABLE shortlist** (current code) is circular and biased. Regime breadth must be measured on the **liquid universe** (or a fixed index membership like Nifty 500), not on names that already survived research.

---

## 1. Frozen pipeline

```
Universe (~2000 NSE EQ)
        ↓
Liquidity (price + ADTV)                    [hard filter]
        ↓
Stage 1  Market Regime                      [risk dial]
        ↓
Stage 2  Sector Ranking                     [hard gate / hybrid]
        ↓
Stage 3  Sector Leader Pool (~60–100)       [eligibility + size]
        ↓
Stage 4  Research Score                     [rank within pool]
        ↓
Stage 5  Top 40
        ↓
Stage 6  Setup Engine                       [entry shape]
        ↓
Stage 7  Trade Plan                         [buy/stop/target]
        ↓
Stage 8  AI Portfolio Construction           [combination, not prediction]
        ↓
Execution → Position Manager
```

**Removed from Stages 2–5 forever:** today’s % change, today’s gap, today’s RVOL as ranking inputs.  
Those belong in Stage 6–7 only if useful for *entry quality* (e.g. breakout RVOL confirmation — already in setup).

---

## 2. Principle: a stock must earn the right to be considered

Equal treatment of 2,000 names is wrong for a **discretionary-style swing book** that wants institutional flow. Equal treatment is correct only for a pure cross-sectional factor portfolio that holds 100+ names.

Your product holds ~5 names. Flow hierarchy matters more than democratic scoring.

That said: hierarchy without relative benchmarks creates blind spots (Challenge 1–2). The design below keeps your principle and patches the blind spots.

---

## 3. Stage 1 — Market Regime

### 3.1 Question

Before any stock: *What risk posture should new long capital take?*

### 3.2 Inputs (all from last completed session unless noted)

| Signal | Definition | Already in codebase? |
|--------|------------|----------------------|
| Nifty trend | `EMA20(?NSEI) vs EMA50`; slope of EMA20 over 5d | Partial (index quotes + bars) |
| BankNifty trend | same for `^NSEBANK` | Partial |
| Index RS internal | BankNifty 20d return − Nifty 20d return (risk-on vs defensive tilt) | Easy add |
| India VIX level + 5d change | regime stress | Quotes exist |
| Advance/Decline | among **liquid universe**: % with `close > prior close` over 1d and over 5d | Must recompute on liquid set, not shortlist |
| Sector breadth | % of sectors with SectorRS20 > 1 | Needs Stage 2 first |

### 3.3 Deterministic regime classifier (v1 prior — calibrate later)

Compute a **RegimeScore** ∈ [0, 100]:

| Component | Score contribution |
|-----------|-------------------|
| Nifty trend UP | +25; SIDEWAYS +10; DOWN +0 |
| BankNifty trend UP | +15; SIDEWAYS +5; DOWN +0 |
| Liquid A/D 5d ≥ 55% | +20; 45–55% +10; else +0 |
| Sector breadth ≥ 50% sectors RS20>1 | +20; 35–50% +10; else +0 |
| India VIX | if VIX ≤ 14 → +20; 14–18 → +12; 18–22 → +5; >22 → +0; additional −10 if VIX 5d change > +15% |

| RegimeScore | Label | Effect |
|-------------|-------|--------|
| ≥ 70 | Aggressive | Full Top 40; standard setup gates; AI full deploy rules |
| 45–69 | Balanced | Default |
| 25–44 | Defensive | Prefer higher research-score floor for AI; optional `RANK_TOP_K=30`; stricter setup ADX already helps |
| < 25 | No-trade | Compute ranks for audit; **skip new buys** (feature-flagged; default OFF until backtested) |

**Evidence:** Trend + breadth + vol regime is standard risk overlay in CTA / discretionary desks. Exact cutoffs are **priors** — promote No-trade only with evidence (Challenge 4).

### 3.4 What Stage 1 must NOT do

- Must not pick stocks  
- Must not use AI  
- Must not use today’s intraday noise as the primary classifier for a morning swing run (use prior EOD)

---

## 4. Stage 2 — Sector Ranking

### 4.1 Question

*Where is institutional money flowing across the market?*

### 4.2 Sector return (relative, not absolute)

For each sector *s* with ≥ `MIN_SECTOR_MEMBERS` liquid names (default 8):

```
R_s,L = equal-weight mean of member returns over L sessions
R_mkt,L = equal-weight mean of ALL liquid names over L
      (preferred) or Nifty L return (acceptable v1)

SectorRS_L = (1 + R_s,L) / (1 + R_mkt,L)
```

Compute L ∈ {5, 20}. Primary rank key = **SectorRS_20**. Tie-break = SectorRS_5.

**Why equal-weight liquid peers, not Nifty alone?**  
Nifty is mega-cap biased. Equal-weight liquid universe better approximates “where breadth of money is going” for a mid/liquid swing book. If peer count is thin, fall back to Nifty.

### 4.3 Sector score (0–100)

Cross-sectional percentile of SectorRS_20 across sectors (only sectors passing member minimum).

Optional persistence bonus (small):

```
if SectorRS_5 percentile ≥ 60 and SectorRS_20 percentile ≥ 60: +5 (cap 100)
```

### 4.4 Hard gate

```
EligibleSectors = top S sectors by SectorScore
S default = 5  (config RANK_SECTOR_TOP_N)
```

**Hybrid wildcard (recommended):** Stage 3–5 may admit up to `RANK_WILDCARD_PCT=0.20` of Top 40 from outside EligibleSectors if stock Research Score would have ranked in global top 5% on RS+52w alone (see §6.7).

### 4.5 Why this stage deserves to exist

Moskowitz & Grinblatt (1999): industry momentum is large and persistent. Practitioner swing process: *strong stock in strong sector* beats strong stock in weak sector at similar chart quality (Challenge 2 acknowledges exceptions → hybrid).

### 4.6 Current weakness in Stock Buddy

Today `sectorMomentum` averages **same-day change% of shortlisted names** — circular and absolute. Stage 2 replaces that with **full liquid-universe, multi-day, relative** sector RS.

---

## 5. Stage 3 — Sector Leader Pool

### 5.1 Question

*Inside flowing sectors, who is allowed into research?*

This stage **sizes the pool** (~60–100), it does not produce the final Top 40.

### 5.2 Eligibility (all must pass)

For stock *i* in an EligibleSector (or wildcard path):

1. Liquidity already passed  
2. History ≥ `REC_MIN_HISTORY`  
3. **Not a 1-day wonder:** exclude if single-day return at t is > 3σ of its 20d daily returns **and** 5d return without that day is ≤ 0 (anti-spike gate)  
4. Optional: price above EMA50 **or** RS20 > 1 (very weak trend/RS floor — keeps pool from filling with junk in a strong sector)

### 5.3 Per-sector cap into pool

```
Take top M stocks per EligibleSector by a cheap pre-score:
  pre = 0.5 * pct(RS20_vs_Nifty) + 0.3 * pct(P/52wHigh) + 0.2 * pct(TrendStack)
M default = 16
Pool ≈ S * M = 5 * 16 = 80
```

Pre-score uses the **same definitions** as Stage 4 factors (no news, no earnings).  
Purpose: computational thrift + enforce “leaders first” without a second philosophy.

### 5.4 Explicitly excluded here

| Signal | Why excluded |
|--------|--------------|
| Today’s % / gap / RVOL | Recency / chase bias |
| News headlines | Non-deterministic, not backtestable |
| Earnings | Include in Stage 4 Event only when calendar data exists |

---

## 6. Stage 4 — Research Score

### 6.1 Single question

> How likely is this stock to outperform the **average liquid NSE stock** over the next **5 trading days**?

Horizon primary label: **5d excess return vs equal-weight liquid universe** (also track vs Nifty).

### 6.2 Scoring method

1. Compute raw factors on the **leader pool** (and for percentile stability, optionally percentile against **all liquid** — recommended: percentiles vs **all liquid**, score only pool members).  
2. Map each factor → percentile 0–100.  
3. Category score = weighted mean of factor percentiles.  
4. `researchScore` = weighted mean of category scores.  
5. Emit `reasons[]` from factors with percentile ≥ 80.

**Percentile vs all liquid** avoids grade inflation inside a strong sector (everyone looks like 90th percentile if you only rank within Defence).

### 6.3 Category weights (frozen prior for v1)

**Approved 2026-08-06.** Event weight = 0 for v1 (unreliable / incomplete data). Its 5pp moved into Trend Quality.

| Category | Weight | Your intent |
|----------|--------|-------------|
| Relative Strength | **0.25** | Highest — vs Nifty and vs sector |
| Trend Quality | **0.25** | EMA / ADX / HH-HL (raised from 0.20) |
| Near 52-week High | **0.15** | “Huge” — now explicit |
| Momentum Persistence | **0.15** | Reward steady grind, not one candle |
| Sector Leadership | **0.10** | Soft boost after hard sector gate (not double-counted as 25%) |
| Volume Confirmation | **0.10** | Accumulation *proxy* |
| Event | **0.00** | Disabled v1 — earnings/news unreliable; gap incomplete |
| **Total** | **1.00** | |

Why Sector is 10% not 15% after a hard sector gate: the gate already did most of the sector work. Keeping 15% + hard gate overweight sector twice. If you switch to Soft mode (no hard gate), raise Sector to **0.18** and cut Persistence to 0.12.

Why Event = 0 (not 5%): breakout-near-high overlap is already in Near-52w + RS; earnings calendar absent; gap series incomplete without bar `open`. A non-zero Event weight would redistribute unpredictably when factors are missing. Revisit Event as a separate category only when delivery/earnings/gap data is production-ready — or fold a single deterministic breakout-proximity factor into Near-52w later via backtest.

---

### 6.4 Factor dictionary

Notation: `C_t` last completed close. Percentiles are cross-sectional unless noted.

---

#### A. Relative Strength — 25%

**Not RSI.** Relative performance.

| ID | Factor | Formula | Why it raises 5d outperformance odds |
|----|--------|---------|--------------------------------------|
| RS1 | vs Nifty 20d | `(1+r_i,20)/(1+r_nifty,20)` | Intermediate relative winners continue; core swing RS |
| RS2 | vs Nifty 5d | same, L=5 | Horizon-matched leadership for next few sessions |
| RS3 | vs Sector 20d | `(1+r_i,20)/(1+r_sector,20)` | Within-group leadership; institutions buy sector leaders first |
| RS4 | RS acceleration | `pctile(RS2) - pctile(RS1)` then percentile of that delta | Improvers > stale leaders for short horizon |

**Sub-weights:** RS1 0.40, RS3 0.30, RS2 0.20, RS4 0.10.

**Skip-day for RS1:** compute 20d return ending at t−1 excluding day t (formation skip) to reduce short-term reversal contamination. Default ON for RS1; OFF for RS2.

**Evidence:** Jegadeesh–Titman momentum; practitioner “strong stock, strong sector”; rank improvers used in RS desks.

---

#### B. Trend Quality — 20%

| ID | Factor | Formula | Why |
|----|--------|---------|-----|
| TQ1 | EMA stack | 100 if `C>EMA20>EMA50>EMA200`; 66 if `C>EMA20>EMA50`; 33 if `C>EMA20`; else 0 | Trend systems and discretionary desks align with stack; reduces chop |
| TQ2 | ADX directional | `ADX(14)` if `+DI > -DI`, else 0 before percentile | ADX = trend *quality*; +DI filter enforces long bias |
| TQ3 | Higher highs / higher lows | Over last 10 sessions: count of rising swing highs and rising swing lows (simple: `high_t > high_{t-5}` and `low_t > low_{t-5}` → 1; both → 2; map 0/1/2 → 0/50/100) | Structural uptrend persistence; matches how swing traders define trend without indicators alone |

**Sub-weights:** TQ1 0.40, TQ2 0.35, TQ3 0.25.

**Not used:** RSI “overbought” as a penalty — fights momentum.

---

#### C. Near 52-week High — 15%

| ID | Factor | Formula | Why |
|----|--------|---------|-----|
| H1 | Closeness | `C_t / max(high_{t-251..t})` | George–Hwang (2004): nearness to 52w high predicts future returns better than raw past returns; anchoring underreaction |

Optional soft extension guard (does not remove near-high premium):

```
if (C - EMA20)/ATR14 > 4: multiply H1 percentile by 0.85
```

Extreme parabolic extension raises 1–5d mean-reversion risk without denying the 52w factor.

**Evidence:** George & Hwang JF literature; IBD / breakout desks live near highs.

---

#### D. Momentum Persistence — 15%

**This replaces rewarding a single +10% day.**

| ID | Factor | Formula | Why |
|----|--------|---------|-----|
| P1 | Positive-day fraction | `# of days with r>0 in last 10 / 10` | Steady demand |
| P2 | Path smoothness | `r_10d / sum(|r_d| for last 10d)` ∈ [-1,1] → percentile | +2,+1.5,+1,+2 scores high; +10,−8 scores low |
| P3 | 5d / 20d consistency | `1` if sign(r5)==sign(r20)==+1 and r5>0; else 0 → contributes 0 or 100 | Multi-horizon agreement |

**Sub-weights:** P2 0.45, P1 0.35, P3 0.20.

**Evidence:** Short-horizon reversal after one-day extremes; continuation stronger when momentum is distributed across sessions (practitioner + microstructure intuition). P2 is the mathematical form of your “not one huge candle” rule.

---

#### E. Sector Leadership — 10%

| ID | Factor | Formula | Why |
|----|--------|---------|-----|
| SL1 | SectorScore of member’s sector | from Stage 2 (0–100) | Tail wind |
| SL2 | Rank within sector on RS20 | percentile within sector peers | Local leadership |

**Sub-weights:** SL1 0.5, SL2 0.5.

---

#### F. Volume Confirmation — 10%

**Not today’s RVOL alone. Accumulation proxy.**

| ID | Factor | Formula | Why |
|----|--------|---------|-----|
| V1 | Upside volume dominance | `sum(vol on up days last 15) / sum(vol on down days last 15)` | Demand on rallies > supply on dips |
| V2 | Pullback volume dryness | On the last 5 down days (or days C below EMA20): `mean(vol)/mean(vol_20)` — **lower is better** → invert percentile | Constructive pullbacks occur on lighter volume |
| V3 | Persistent participation | `mean(vol_5)/mean(vol_20)` | Sustained interest, not one spike |

**Sub-weights:** V1 0.45, V2 0.30, V3 0.25.

**Gate:** if RS1 percentile < 40, cap category F at 40 (volume without RS = potential distribution).

**v1.1:** replace/enhance V1 with delivery % when NSE delivery is available.

---

#### G. Event — 0% (disabled v1)

Category retained in the schema for a future config bump; **not scored in v1**.

| ID | Factor | Status |
|----|--------|--------|
| E1 | Breakout state | Covered indirectly by Near-52w + RS; do not double-count |
| E2 | Trend-aligned gap | Blocked on historical `open` |
| E3 | Earnings | No calendar data |

When re-enabled, start at ≤0.05 and cut Trend or Sector soft weight accordingly — only after data exists and IC is measured.

---

### 6.5 Output object

```ts
{
  symbol: string;
  researchScore: number;          // 0–100 overall
  relativeStrengthScore: number;
  trendScore: number;
  nearHighScore: number;
  persistenceScore: number;
  sectorScore: number;
  volumeScore: number;
  eventScore: number;             // always 0 in v1
  marketRegime: 'Aggressive' | 'Balanced' | 'Defensive' | 'No-trade';
  sectorName: string;
  sectorRank: number;
  poolRank: number;
  reasons: string[];
}
```

### 6.6 Top 40 selection

```
Sort pool by researchScore DESC
Tie-break: RS1 percentile, then ADTV
Apply hybrid wildcard seats if enabled
Take RANK_TOP_K (default 40)
```

Optional diversity soft cap **before AI** (deterministic): max `ceil(0.25 * K)` names per sector in Top 40 so Setup/AI are not handed 20 Defence names. This is research-list hygiene, not portfolio construction.

---

### 6.7 Wildcard rule (Hybrid mode)

A non-eligible-sector name may enter Top 40 if:

```
pctile(RS1) ≥ 95 AND pctile(H1) ≥ 90 AND TQ1 ≥ 66
```

Fill at most `floor(RANK_WILDCARD_PCT * K)` such seats, ranked by researchScore among wildcards.

---

## 7. Stages 6–8 — boundaries (so Research stays pure)

| Stage | Owns | Must not do |
|-------|------|-------------|
| Setup | Pullback / breakout / retest detection | Re-rank research quality |
| Trade Plan | Entry band, stop, target, RR | Decide “good stock” |
| AI | Portfolio combination under constraints | Predict which stock goes up most |

### AI prompt posture (design intent)

Not: “Pick 5 winners.”  
Yes: “Here are 40 research-ranked candidates with scores/reasons + regime. Build the best **portfolio** given diversification, sector caps, risk, overlapping themes, and cash rules. Copy engine prices.”

This matches your three-problem split:

1. **Research** — this document  
2. **Entry** — existing setup/trade-plan work  
3. **Portfolio** — AI as PM  

---

## 8. Data requirements

### Have now

- NSE bhav OHLCV + traded value (ADTV)  
- Yahoo daily bars, Nifty / BankNifty / India VIX  
- EMA, ADX, ATR, RS20, returns, dist52w (indicators)  
- Yahoo sector (must expand to **all liquid**, not shortlist)

### Must add for Stage 2–4 fidelity

| Item | Priority |
|------|----------|
| Persist sector (and industry) on universe / liquid set | P0 |
| Breadth on liquid universe | P0 |
| Keep bar `open` for gap series | P1 |
| Delivery % | P1 |
| Earnings calendar | P2 |

---

## 9. What we remove from research ranking

| Remove | Reason |
|--------|--------|
| Today’s % change | Chase / short-term reversal |
| Today’s gap | Same; entry concern |
| Today’s RVOL as alpha | Spike ≠ persistence; setup may still use RVOL for breakout validity |
| Activity prioritizer score | Wrong objective |
| News in deterministic rank | Not reproducible |

---

## 10. Evidence plan (judgment → system)

Do **not** tune weights by gut after one week of live paper.

### Backtest harness (minimum)

For each historical day *T* (EOD features):

1. Apply liquidity  
2. Run Stage 1–5 → Top 40  
3. Label: equal-weight average 5d forward return of Top 40 minus equal-weight liquid universe 5d return  
4. Also: Spearman IC of `researchScore` vs 5d excess among pool  
5. Baselines: (a) current Activity top 40, (b) top 40 by RS20 only, (c) random liquid 40  
6. Ablations: Strict vs Hybrid sector gate; with/without Persistence; with/without 52w  

### Promotion rule

A config change ships only if walk-forward 5d excess of Top 40 improves vs baseline without collapsing breadth diversity to one sector (max sector share diagnostic).

---

## 11. Suggested config surface

```
RANK_TOP_K=40
RANK_SECTOR_TOP_N=5
RANK_PER_SECTOR_POOL=16
RANK_SECTOR_MODE=hybrid          # strict | soft | hybrid
RANK_WILDCARD_PCT=0.20
RANK_MAX_SECTOR_SHARE=0.25

RANK_W_RS=0.25
RANK_W_TREND=0.25
RANK_W_NEAR_HIGH=0.15
RANK_W_PERSISTENCE=0.15
RANK_W_SECTOR=0.10
RANK_W_VOLUME=0.10
RANK_W_EVENT=0.00

RANK_REGIME_NOTRADE_ENABLED=false
RANK_SKIP_DAY_RS20=true
```

---

## 12. Integration with existing Setup Engine

Research Top 40 → existing `detectSetup` unchanged:

- BREAKOUT_RETEST / BREAKOUT_FRESH / PULLBACK_EMA20 / PULLBACK_PDH  
- Trade plan STRUCTURE_ATR_V1  

Setup still uses ADX min, breakout RVOL, etc. That is **entry confirmation**, not research alpha — consistent with removing RVOL from Stages 2–5.

Expected funnel after change:

```
~2000 → liquid ~800–1200 → eligible sectors → pool ~80
  → Top 40 → BUYABLE (VALID plan) << 40 → AI picks ~5
```

---

## 13. Decisions — frozen 2026-08-06

| # | Decision | Choice |
|---|----------|--------|
| 1 | Sector mode | **Hybrid** (≤20% wildcard seats) |
| 2 | S / M / K | **5 / 16 / 40** |
| 3 | Weights | §6.3 with **Trend 25% / Event 0%** |
| 4 | No-trade hard skip | **OFF** until backtested |
| 5 | Breadth universe | **All liquid** |
| 6 | AI prompt | **Light tweak now**; full PM rewrite later |

---

## 14. Bottom line

Your hierarchy — **Market → Sector → Leaders → Research → Setup → Plan → AI PM** — is the right product architecture.

Frozen patches:

1. Sector ranks are **relative**, not absolute  
2. Sector hard gate is **Hybrid** until evidence says Strict wins  
3. Persistence + near-52w are first-class; today’s %/gap/RVOL stay out of research  
4. Regime is a **risk dial** first, kill-switch second  
5. Event category weight **0** in v1  
6. One research score philosophy; Stages 2–3 only decide *who is allowed to compete*

**Next step:** live paper run under `REC_SHORTLIST_MODE=ranking`, then backtest harness for Top-40 5d excess vs Activity baseline.
