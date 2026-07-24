# Ticket Management App

Multi-tenant, workspace-isolated ticket manager. See [DESIGN.md](./DESIGN.md) for the full design and roadmap.

**Stack:** React + Vite + TypeScript (frontend) · Express + Prisma + PostgreSQL (backend) · Google SSO (invite-only) · in-app + email notifications.

## Prerequisites

- Node 20+
- Docker (for PostgreSQL)

## Quick start

```bash
# 1. Start PostgreSQL (runs on host port 5433)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # already has working dev defaults
npm install
npx prisma migrate dev        # create schema
npm run db:seed               # seed CEO, devs, two client workspaces, sample tickets
npm run dev                   # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173. Google OAuth is disabled until you add credentials, so use
**Dev login** to sign in as any seeded account:

| Account | Role |
|---|---|
| Prateek (CEO) | Super Admin |
| Dana Dev | Developer (both workspaces) |
| Fred | Freelancer (both workspaces) |
| Alice — Acme | Client (Acme workspace) |
| George — Globex | Client (Globex workspace) |

## Enabling Google SSO

1. Create OAuth credentials at https://console.cloud.google.com/apis/credentials
2. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `backend/.env`
3. Add `http://localhost:4000/auth/google/callback` as an authorized redirect URI
4. Set `DEV_LOGIN_ENABLED="false"` for production

Login is **invite-only**: a user can only sign in if they already exist or have a pending
invite (Super Admin invites them per workspace from the workspace sidebar).

## Notifications (in-app + Telegram)

Notifications are **in-app** (the bell) plus **Telegram** for ticket lifecycle events
(created / assigned / status changed). There is no email.

Telegram setup:
1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **bot token**.
2. Create a team group/channel, add your bot to it.
3. Get the chat id (e.g. add [@RawDataBot](https://t.me/RawDataBot) to the group, or call
   `https://api.telegram.org/bot<token>/getUpdates` after posting a message).
4. Set in `backend/.env`:
   ```
   TELEGRAM_BOT_TOKEN="123456:ABC..."
   TELEGRAM_CHAT_ID="-1001234567890"
   ```
Without these, Telegram messages are logged to the backend console (handy in dev).

**Invites** are link-based (no email): the Super Admin creates an invite in the workspace
sidebar and shares the generated link; the invitee signs in with Google to accept.

## Project layout

```
backend/    Express API, Prisma schema, auth, RBAC + workspace-isolation middleware
frontend/   React SPA (auth, dashboard, workspace boards, ticket detail, notifications)
docker-compose.yml   PostgreSQL
DESIGN.md   Full design & phased plan
```

## What's implemented

**Phase 1 (MVP):** Auth (Google SSO + invite-only, dev login), workspace isolation + RBAC,
ticket CRUD/assign/self-assign/status, threaded comments with internal vs client visibility,
@mentions, in-app + Telegram notifications, link-based invites, "My Tickets" dashboard.

**Phase 2 (in progress):** File attachments on tickets (images/PDF/docs, 10 MB cap) with the
same internal/client visibility rules and authenticated downloads. Files are stored on local
disk under `backend/uploads/` (set `UPLOAD_DIR`/`MAX_UPLOAD_MB`); **swap to S3/R2 before
deploying to a PaaS** since their filesystems are ephemeral.

Remaining Phase 2/3 items (Kanban, time tracking, labels, audit log, real-time, etc.) are in DESIGN.md.
