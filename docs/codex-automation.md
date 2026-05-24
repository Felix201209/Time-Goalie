# Codex Daily Automation

Goal: Codex runs the ManageBac scan on the Mac every day, then posts a lightweight snapshot to the Raspberry Pi service.

Recommended schedule:

- Timezone: `Asia/Shanghai`
- Time: `00:35` daily
- Command:

```bash
cd /Users/felix/Desktop/Time-Goalie-Public
HOMEWORK_GOALIE_SYNC_URL=http://192.168.0.110:4588/sync \
HOMEWORK_GOALIE_SYNC_TOKEN="$HOMEWORK_GOALIE_SYNC_TOKEN" \
npm run scan
```

Dry run:

```bash
npm run scan:dry
```

Notes:

- ManageBac session stays on the Mac at `~/.codex/private/managebac/ibwya-storage-state.json`.
- The Pi receives only `homework-snapshot.json`, never cookies.
- If a future Codex automation tool is available, register this exact command as the recurring job.

Installed macOS fallback:

```bash
scripts/install-launchd.sh
```

This installs `com.felix.homework-goalie.scan`, running daily at `00:35`.
