#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.felix.homework-goalie.scan"
SOURCE="${ROOT}/launchd/${LABEL}.plist"
TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs"
cp "${SOURCE}" "${TARGET}"
launchctl bootout "gui/$(id -u)" "${TARGET}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${TARGET}"
launchctl enable "gui/$(id -u)/${LABEL}"
launchctl print "gui/$(id -u)/${LABEL}" | sed -n '1,80p'
