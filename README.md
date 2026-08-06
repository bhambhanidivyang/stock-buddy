# Stock Buddy

Paper-trading app to validate AI stock picks before real money.

```text
stock-buddy/
  backend/    NestJS API + Postgres
  frontend/   Next.js UI
```

## Prerequisites

- Node.js 22+ (local dev)
- Docker + Compose (local Postgres **or** full stack)

## Docker (OCI / single VM)

Full stack (Postgres private + Nest API + Next.js UI). See **[docs/DEPLOY-OCI.md](docs/DEPLOY-OCI.md)**.

```bash
cp .env.example .env   # set secrets + NEXT_PUBLIC_API_URL / FRONTEND_ORIGIN
docker compose --env-file .env up -d --build
# UI http://localhost:3001  API http://localhost:3000
```

## Setup (local, API + UI on host)

```bash
# DB only
docker compose --env-file .env up -d postgres
# If using root .env, set DATABASE_HOST=localhost for host-run Nest
```

```bash
# API
cd backend
cp .env.example .env   # if needed
npm install
npm run migration:run
npm run start:dev      # http://localhost:3000

# UI
cd ../frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000
npm install
npm run dev                  # http://localhost:3001
```

Frontend flow: `/login` or `/register` → `/statements` (Overview, Portfolio, Recommendations, Execution, Statements, Settings).

## Market universe

Stock Buddy always uses the **full NSE EQ** universe (synced from NSE), not a fixed watchlist.

```bash
# Sync equity master + recent bhavcopy into Postgres (required once / daily)
curl -X POST http://localhost:3000/market/sync
```

Pipeline: NSE universe → bhav ADTV filter → live Yahoo quotes → activity prioritizer (top N) → deep charts/levels + Yahoo sector/fundamentals → AI.

## Compounding / cash deploy

Paper goal: grow `availableCash` (starts from `DAILY_FUND`) by deploying **nearly all cash** on trading days when the AI finds setups. Leftover of a few hundred–₹2.5k from share lots is OK; large intentional cash reserves while holding 1–2 small positions are not.

Controlled by `REC_FULL_CASH_DEPLOY` (default true): validator tops up qty after AI sizing, within `REC_MAX_ALLOC_PCT` per name. AI is prompted to pick enough names (typically 3–5) to fill the book, or return **empty** and stay in cash.

## Scheduler (IST)

Nest cron inside the API process (disabled by default).

| Job | When (weekdays IST) | Env |
|-----|---------------------|-----|
| `nse_sync` | 18:30 | `SCHEDULER_ENABLED=true` |
| `recommend` | 08:45 | `SCHEDULER_ENABLED=true` |
| `execute` | 09:14 | also `SCHEDULER_AUTO_EXECUTE=true` |

Boot catch-up runs missed jobs for the current IST weekday. Manual trigger (JWT required):

```bash
curl -X POST http://localhost:3000/jobs/trigger/nse_sync \
  -H "Authorization: Bearer $ACCESS"
```

## Docs

- API: [backend/docs/API.md](backend/docs/API.md)
