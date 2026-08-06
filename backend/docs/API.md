# Stock Buddy API

Base URL (local): `http://localhost:3000`

Auth: send `Authorization: Bearer <accessToken>` on all non-public routes.  
`POST /auth/register` and `POST /auth/login` return `{ user, accessToken, refreshToken }`.  
Access JWT expires in **15m**; use `POST /auth/refresh` with `{ refreshToken }` to rotate.  
Paper ledger is one paper account per authenticated user (`accounts.user_id`).

Public: `GET /`, `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`.

---

## Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health / hello (public) |
| `POST` | `/auth/register` | Create user + access/refresh tokens (public) |
| `POST` | `/auth/login` | Login + access/refresh tokens (public) |
| `POST` | `/auth/refresh` | Rotate access + refresh tokens (public) |
| `POST` | `/auth/logout` | Revoke refresh token (auth required) |
| `GET` | `/auth/me` | Current user profile (auth required) |
| `POST` | `/market/sync` | Refresh NSE universe + bhav (auth required) |
| `POST` | `/jobs/trigger/:job` | Manual job run: `nse_sync` \| `recommend` \| `execute` \| `catchup` (auth) |
| `POST` | `/recommendations` | AI recommendation plan (new instance; may be empty) |
| `POST` | `/execute` | Start / replace execution session (today's plan only; allows add-on lots) |
| `GET` | `/execute/status` | Current execution status |
| `POST` | `/execute/stop` | Stop running session |
| `GET` | `/balance` | Cash + MTM equity |
| `GET` | `/portfolio` | Open + NEEDS_REVIEW holdings |
| `POST` | `/portfolio/:tradeId/review` | Human action on NEEDS_REVIEW (`SELL` \| `RESUME`) |
| `GET` | `/statement` | Daily P&L statement rows |

This is **paper trading only** — buys/sells are DB ledger writes (no real broker orders). Cloud hosting is for 24/7 remote access while you validate profitability.

### Scheduler (IST)

Set `SCHEDULER_ENABLED=true` in `.env` to activate Nest crons (off by default for local safety).  
Optional `SCHEDULER_AUTO_EXECUTE=true` arms OMS at **09:14** from today's PENDING plan.

| Cron | Time (Mon–Fri IST) | Job |
|------|--------------------|-----|
| `nse_sync` | 18:30 | Equity master + bhav |
| `recommend` | 08:45 | AI plan |
| `execute` | 09:14 | Start execution (opt-in) |

Once-per-day idempotency via `scheduler_runs`. EOD force-flat still runs inside the execution poller (15:15–15:30 IST).

Typical flow:

```text
POST /recommendations  →  POST /execute  →  GET /balance | GET /portfolio
         ↑                      │
         └──── re-run anytime ──┘  (new execute replaces prior session)
```

### End-of-day paper policy (IST)

Hard paper sells need the market open (live quotes). Settlement is split:

**Live force-flat window — 15:15–15:30 IST** (15 minutes before close)

| Position | Action |
|----------|--------|
| `WAITING_BUY` | Cancel → `CLOSED` / `CANCELLED_EOD` |
| `OPEN` and mark **> buy** | Paper sell → `CLOSED` / `EOD_PROFIT` |
| `OPEN` and mark **≤ buy** (or no quote) | Hold → `NEEDS_REVIEW` |

**Missed that window (service down / after 15:30)** — no hard sells

| Position | Action |
|----------|--------|
| `WAITING_BUY` | Cancel → `CANCELLED_EOD` |
| All remaining `OPEN` | → `NEEDS_REVIEW` (human decision) |
| Session | Stop / wind up offline work only |

`NEEDS_REVIEW` lots stay in portfolio/balance MTM until `POST /portfolio/:tradeId/review` acts on them.

---

## `GET /`

Liveness check.

**Response:** `200` plain text

```text
Hello World!
```

---

## Auth

### `POST /auth/register`

Create a user account.

**Body**

| Field | Type | Rules |
|-------|------|--------|
| `firstName` | string | required |
| `lastName` | string | required |
| `email` | string | required, email |
| `password` | string | required, min 8 chars |

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "password": "secret123"
}
```

**Success:** `201`

```json
{
  "user": {
    "email": "ada@example.com",
    "firstName": "Ada",
    "lastName": "Lovelace"
  },
  "accessToken": "<jwt>"
}
```

**Errors**

| Status | When |
|--------|------|
| `400` | Email already in use / validation failure |

---

### `POST /auth/login`

**Body**

| Field | Type | Rules |
|-------|------|--------|
| `email` | string | required |
| `password` | string | required |

```json
{
  "email": "ada@example.com",
  "password": "secret123"
}
```

**Success:** `201`

```json
{
  "user": {
    "email": "ada@example.com",
    "firstName": "Ada",
    "lastName": "Lovelace"
  },
  "accessToken": "<jwt>"
}
```

**Errors**

| Status | When |
|--------|------|
| `401` | Invalid credentials |

---

## Recommendations

### `GET /recommendations`

Lists past recommendation runs for the signed-in account (newest first).

Query: `limit` (default `50`, max `100`).

Each row includes items, plan `confidence`, `portfolioStrategy`, `portfolioSummary`, and:

- `bought` / `boughtLabel` — whether execute was started for this plan (`yes` / `no`)
- `executionSessionCount`

### `GET /recommendations/:id`

Single run in the same shape as list rows.

### `POST /recommendations`

Builds a live market context pack (Yahoo quotes + curated universe), calls OpenAI with the institutional prompt, validates picks, and persists a new **recommendation run** (`PENDING`).

No request body. Empty `items` is valid (low-conviction day — cash reserved).

Requires env: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`.

Per-account daily cap (IST calendar day): `REC_MAX_PER_DAY` (default `3`). Excess calls return `429`.

**Success:** `201`

```json
{
  "id": "uuid",
  "status": "PENDING",
  "marketTs": "2026-07-25T20:41:30.690Z",
  "marketSession": "CLOSED",
  "availableCash": 100000,
  "totalAllocatedInr": 99568.05,
  "cashReservedInr": 431.95,
  "portfolioSummary": "...",
  "marketRegime": "MODERATELY_BULLISH",
  "confidence": "MEDIUM",
  "portfolioStrategy": {
    "style": "BALANCED",
    "targetPositions": 3,
    "cashReservePercent": 2,
    "hedge": false,
    "reason": "..."
  },
  "model": "gpt-5.6-luna",
  "items": [
    {
      "id": "uuid",
      "symbol": "HCLTECH",
      "qty": 25,
      "allocationInr": 31775,
      "buyLow": 1260,
      "buyHigh": 1280,
      "sellTarget": 1340,
      "stopLoss": 1235,
      "role": "PRIMARY",
      "summary": "..."
    }
  ]
}
```

`role`: `PRIMARY` | `HEDGE`  
`marketSession`: `PRE_OPEN` | `OPEN` | `CLOSED`

App validation drops/adjusts bad picks (RR &lt; 2:1, stale band vs LTP, stop/target % extremes, low volume, &gt;2 per sector, price order). Position size: each pick must be **8–30%** of `availableCash` (oversized names are capped; undersized dropped). No max total deploy — prefer investing available cash when conviction exists. Duplicate symbols in one plan are merged.

**Errors**

| Status | When |
|--------|------|
| `503` | Missing OpenAI config / OpenAI failure |

### `PATCH /recommendations/:id`

Edit a **PENDING** plan before execute. Body lists kept items (qty, allocation, buy band, target, stop). Omitted item ids are removed from the plan.

```json
{
  "items": [
    {
      "id": "uuid",
      "qty": 10,
      "allocationInr": 25000,
      "buyLow": 240,
      "buyHigh": 250,
      "sellTarget": 275,
      "stopLoss": 230
    }
  ]
}
```

Validates levels (`stop < buyLow`, `target > buyHigh`, `buyLow <= buyHigh`) and total allocation ≤ available cash.

**Success:** `200` (updated run + items)

---

## Execute

Paper trade runner. One `RUNNING` session per account. New `/execute` **stops** the previous session, cancels its unfilled `WAITING_BUY` legs, keeps already-`OPEN` / `NEEDS_REVIEW` lots, and starts the latest (or specified) **today's** plan.

Buys only when **market is OPEN** (before 15:15 IST force-flat) and price is inside the AI entry band. Sells on target/stop. Same symbol may create a **second lot** if already held.

### `POST /execute`

**Body** (optional)

```json
{
  "recommendationId": "uuid"
}
```

- If omitted: latest `PENDING` recommendation for the caller's paper account.
- If provided: that run (must be executable).

**Success:** `201`

```json
{
  "sessionId": "uuid",
  "recommendationId": "uuid",
  "status": "RUNNING",
  "startedAt": "2026-07-25T20:42:24.055Z",
  "waitingBuyCount": 3,
  "addOnSymbols": ["ITC"],
  "trades": [
    {
      "id": "uuid",
      "symbol": "HCLTECH",
      "qty": 25,
      "status": "WAITING_BUY",
      "buyLow": "1260.0000",
      "buyHigh": "1280.0000",
      "sellTarget": "1340.0000",
      "stopLoss": "1235.0000",
      "role": "PRIMARY"
    }
  ]
}
```

`addOnSymbols`: symbols in this plan that were already `OPEN` / `NEEDS_REVIEW` (second-lot add-ons).

**Errors**

| Status | When |
|--------|------|
| `404` | No pending recommendation / id not found |
| `400` | Run not executable, empty plan, or plan not from today's IST day |

---

### `GET /execute/status`

Live execution board: waiting buys, open lots (with targets), today’s sells, and needs-review.

**Success:** `200`

```json
{
  "status": "IDLE",
  "phase": "MANAGING",
  "active": true,
  "headline": "Managing open exits · 5 open",
  "sessionId": null,
  "waitingBuy": 0,
  "openPositions": 5,
  "needsReviewPositions": 0,
  "soldPositions": 1,
  "managingExits": true,
  "legs": [
    {
      "symbol": "GANDHAR",
      "qty": 84,
      "state": "OPEN",
      "statusLabel": "Open",
      "detail": "Chasing sell target 260 (stop 240)",
      "buyPrice": 247.52,
      "sellTarget": 260,
      "stopLoss": 240,
      "mark": 251.1
    },
    {
      "symbol": "ITC",
      "state": "SOLD",
      "statusLabel": "Sold — target hit",
      "sellTarget": 300,
      "sellPrice": 301.2,
      "exitReason": "TARGET"
    }
  ]
}
```

---

### `POST /execute/stop`

Stops the running session, cancels remaining `WAITING_BUY` legs, leaves `OPEN` holdings alone.

**Success:** `201`

```json
{
  "status": "STOPPED",
  "sessionId": "uuid",
  "stopReason": "MANUAL"
}
```

If nothing running:

```json
{ "status": "IDLE" }
```

---

## Balance

### `GET /balance`

Cash from DB + mark-to-market of `OPEN` and `NEEDS_REVIEW` trades (Yahoo).

**Success:** `200`

```json
{
  "accountId": "uuid",
  "initialFund": 100000,
  "cash": 100000,
  "holdingsValue": 0,
  "invested": 0,
  "equity": 100000,
  "unrealizedPnl": 0,
  "realizedPnl": 0,
  "openPositions": 0,
  "needsReviewPositions": 0,
  "asOf": "2026-07-25T20:41:17.081Z",
  "cashDisplay": "100000.00",
  "equityDisplay": "100000.00"
}
```

`equity` = `cash` + `holdingsValue` (lifetime compounding; `initialFund` is seed only).

---

## Portfolio

### `GET /portfolio`

Holdings with status `OPEN` or `NEEDS_REVIEW`.

**Success:** `200`

```json
{
  "accountId": "uuid",
  "asOf": "2026-07-25T20:41:17.091Z",
  "holdings": [
    {
      "tradeId": "uuid",
      "symbol": "ITC",
      "qty": 149,
      "role": "HEDGE",
      "buyPrice": 283.45,
      "buyAt": "2026-07-26T04:00:00.000Z",
      "invested": 42233.05,
      "currentPrice": 285.1,
      "marketValue": 42479.9,
      "unrealizedPnl": 246.85,
      "buyLow": 280,
      "buyHigh": 286,
      "sellTarget": 300,
      "stopLoss": 274,
      "summary": "...",
      "recommendationItemId": "uuid",
      "executionSessionId": "uuid",
      "status": "OPEN",
      "needsHumanReview": false
    },
    {
      "tradeId": "uuid",
      "symbol": "RELIANCE",
      "qty": 20,
      "role": "PRIMARY",
      "buyPrice": 1278,
      "buyAt": "2026-07-26T05:10:00.000Z",
      "invested": 25560,
      "currentPrice": 1265,
      "marketValue": 25300,
      "unrealizedPnl": -260,
      "buyLow": 1270,
      "buyHigh": 1285,
      "sellTarget": 1340,
      "stopLoss": 1238,
      "summary": "...",
      "recommendationItemId": "uuid",
      "executionSessionId": "uuid",
      "status": "NEEDS_REVIEW",
      "needsHumanReview": true
    }
  ],
  "needsReview": [
    {
      "tradeId": "uuid",
      "symbol": "RELIANCE",
      "qty": 20,
      "status": "NEEDS_REVIEW",
      "needsHumanReview": true
    }
  ],
  "totals": {
    "invested": 67793.05,
    "marketValue": 67779.9,
    "unrealizedPnl": -13.15
  },
  "openTotals": {
    "invested": 42233.05,
    "marketValue": 42479.9,
    "unrealizedPnl": 246.85
  },
  "needsReviewTotals": {
    "invested": 25560,
    "marketValue": 25300,
    "unrealizedPnl": -260
  }
}
```

Empty book:

```json
{
  "accountId": "uuid",
  "asOf": "...",
  "holdings": [],
  "needsReview": [],
  "totals": { "invested": 0, "marketValue": 0, "unrealizedPnl": 0 },
  "openTotals": { "invested": 0, "marketValue": 0, "unrealizedPnl": 0 },
  "needsReviewTotals": { "invested": 0, "marketValue": 0, "unrealizedPnl": 0 }
}
```

### `POST /portfolio/:tradeId/review`

Human decision for a `NEEDS_REVIEW` lot.

**Body**

```json
{ "action": "SELL", "sellTarget": 1340, "stopLoss": 1238 }
```

or hold / resume automation (optional retarget — both levels required together):

```json
{ "action": "RESUME", "sellTarget": 1340, "stopLoss": 1238 }
```

| Action | Behavior |
|--------|----------|
| `SELL` | Paper sell at live Yahoo mark. Requires NSE regular session (09:15–15:30 IST). Exit reason `HUMAN_SELL`. Optional `sellTarget` + `stopLoss` update the lot before close. |
| `RESUME` | Status → `OPEN` so the execution loop manages target/stop again (UI label: **Hold**). Optional retarget. |

**Success:** `200`

```json
{
  "tradeId": "uuid",
  "symbol": "RELIANCE",
  "action": "SELL",
  "status": "CLOSED",
  "sellPrice": 1268.5,
  "proceeds": 25370,
  "realizedPnl": -190,
  "cash": 75240.5
}
```

---


## Curl examples

```bash
# Auth
curl -s -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","password":"secret123"}'

curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"secret123"}'

# Trading
curl -s -X POST http://localhost:3000/recommendations
curl -s -X POST http://localhost:3000/execute -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:3000/execute/status
curl -s http://localhost:3000/balance
curl -s http://localhost:3000/portfolio
curl -s -X POST http://localhost:3000/portfolio/$TRADE_ID/review \
  -H 'Content-Type: application/json' -d '{"action":"SELL"}'
curl -s -X POST http://localhost:3000/execute/stop
```

---

## Related env

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `DAILY_FUND` | Seed / initial paper cash |
| `AI_PROVIDER` | `openai` (required for recommendations) |
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_MODEL` | Model id |
| `POLL_INTERVAL_MS` | Execute loop poll interval |
| `REC_MAX_PER_DAY` | Max recommendation runs per account per IST day (default `3`) |
| `POSTGRES_*` / `DATABASE_*` | Database connection |
