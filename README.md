# Homework Goalie

Homework Goalie is a Raspberry Pi reminder service for Felix's homework workflow.

It is intentionally no-UI. Codex scans ManageBac and the local Homework Vault, sends a lightweight assignment snapshot to the Pi, and the Pi handles Bark reminders, retries, health checks, and high-risk homework escalation.

## What It Does

- Reads assignment notes from `Homework Vault/Assignments`.
- Keeps ManageBac login/session state on the Mac, not on the Pi.
- Sends Bark reminders from the Raspberry Pi.
- Detects `watch`, `urgent`, `critical`, and `rescue` homework risk.
- Creates rescue packets for near-deadline big assignments.
- Blocks unconfirmed graded submissions by policy.

## Quick Start

```bash
npm ci
npm test
npm run scan:dry
```

Run local service:

```bash
cp .env.example .env
HOMEWORK_GOALIE_DATA_FILE=./tmp/state.json npm start
```

Push a scan to the service:

```bash
HOMEWORK_GOALIE_SYNC_URL=http://127.0.0.1:4588/sync npm run scan
```

Deploy to Raspberry Pi:

```bash
scripts/deploy-pi.sh
```

Then edit `/etc/homework-goalie/homework-goalie.env` on the Pi with the real Bark key and sync token.

## API

- `GET /healthz`
- `GET /status`
- `POST /sync`
- `POST /bark/test`
- `POST /events/ack`

If `HOMEWORK_GOALIE_SYNC_TOKEN` is set, protected routes require:

```text
Authorization: Bearer <token>
```

## Files That Must Stay Private

- `.env`
- `.env.local`
- real Bark keys
- ManageBac cookies or storage state
- `/var/lib/homework-goalie/state.json`
- `~/.codex/private/managebac/ibwya-storage-state.json`

## Automation

See `docs/codex-automation.md`.

macOS LaunchAgent fallback:

```bash
scripts/install-launchd.sh
```

## Rescue Boundary

See `docs/rescue-policy.md`.
