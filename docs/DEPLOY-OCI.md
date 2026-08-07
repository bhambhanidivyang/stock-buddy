# Deploy Stock Buddy on Oracle Cloud Free Tier (Ubuntu VM)

Frontend is **Next.js**. Backend is NestJS. Postgres runs only on the Compose network.

## Folder structure

```text
stock-buddy/
  backend/
    .env.example        # template → backend/.env (Nest + Compose)
    Dockerfile
  frontend/
    Dockerfile
  docker-compose.yml    # postgres + backend + frontend
  backups/              # pg_dump output (gitignored volume mount)
  scripts/
    pg-backup.sh        # cron-ready daily dump
  docs/
    DEPLOY-OCI.md       # this file
```

## Network model

| From | To | How |
|------|----|-----|
| Backend container | Postgres | hostname `postgres:5432` (private) |
| Browser | Frontend | `http://VM_IP:3001` (published) |
| Browser | Backend API | `http://VM_IP:3000` via `NEXT_PUBLIC_API_URL` (published) |

Postgres is **not** published on the host (`5432` closed). Do not set `NEXT_PUBLIC_API_URL=http://backend:3000` — browsers cannot resolve Docker DNS.

## VM prep (Ubuntu)

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"   # re-login after
```

Open ingress in OCI Security List / NSG for TCP **3000** and **3001** (and 22 for SSH). Do **not** open 5432.

## Deploy steps

```bash
git clone <your-repo> /opt/stock-buddy
cd /opt/stock-buddy

cp backend/.env.example backend/.env
# Edit backend/.env:
#   POSTGRES_PASSWORD, JWT_SECRET, OPENAI_API_KEY
#   FRONTEND_ORIGIN=http://YOUR_PUBLIC_IP:3001
#   NEXT_PUBLIC_API_URL=http://YOUR_PUBLIC_IP:3000
#   (optional) SCHEDULER_ENABLED=true

mkdir -p backups
chmod +x scripts/pg-backup.sh

docker compose --env-file backend/.env build
docker compose --env-file backend/.env up -d

docker compose --env-file backend/.env ps
docker compose --env-file backend/.env logs -f backend
```

Open `http://YOUR_PUBLIC_IP:3001` → register → use the app.

Optional first market sync (JWT required after login):

```bash
# after login, use access token
curl -X POST http://YOUR_PUBLIC_IP:3000/market/sync \
  -H "Authorization: Bearer $ACCESS"
```

Or enable `SCHEDULER_ENABLED=true` and wait for 18:30 IST.

## Rebuild after code / env URL changes

`NEXT_PUBLIC_API_URL` is baked at **frontend image build** time. If the public IP/URL changes:

```bash
docker compose --env-file backend/.env build --no-cache frontend
docker compose --env-file backend/.env up -d frontend
```

## Backups (manual / cron)

```bash
./scripts/pg-backup.sh
# writes backups/<db>_YYYYMMDD_HHMMSS.sql.gz
```

Install cron yourself (example weekdays 19:15):

```cron
15 19 * * 1-5 /opt/stock-buddy/scripts/pg-backup.sh >> /var/log/stock-buddy-backup.log 2>&1
```

Restore (example):

```bash
gunzip -c backups/stockbuddy_YYYYMMDD_HHMMSS.sql.gz \
  | docker exec -i stock-buddy-postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## Useful commands

```bash
docker compose --env-file backend/.env logs -f
docker compose --env-file backend/.env restart backend
docker compose --env-file backend/.env down          # keeps postgres_data volume
docker compose --env-file backend/.env down -v       # DESTROYS DB volume — careful
```

## Out of scope (by design for this pack)

Kubernetes, Redis, Caddy/Nginx, TLS, monitoring agents. Add later when you harden for public production.
