#!/bin/sh
# Starts the Paws & Play multiplayer game server on http://localhost:8000 (safe to run twice)
cd "$(dirname "$0")" || exit 0
if ! curl -sf http://localhost:8000/ >/dev/null 2>&1; then
  if command -v node >/dev/null 2>&1; then
    setsid nohup node server.js > /tmp/doggy-server.log 2>&1 < /dev/null &
  else
    setsid nohup python3 -m http.server 8000 > /tmp/doggy-server.log 2>&1 < /dev/null &
  fi
fi
