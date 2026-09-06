#!/usr/bin/env bash
# ========================================================================
# GRIDGUARD AI — backend/run.sh
# ========================================================================
# One-command launcher for the complete local stack:
#
#   C++ edge simulator → Mosquitto MQTT → backend bridge → SQLite
#                      → REST/SSE API → frontend dashboard
#
# Usage:
#   ./run.sh              start broker + backend + simulator
#   ./run.sh --no-sim     broker + backend only (no simulated telemetry)
#
# The first run creates the Python virtualenv automatically
# (backend/venv) and installs requirements.txt into it.
# Stop everything with Ctrl+C — all child processes are cleaned up.
# ========================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SIM_DIR="$PROJECT_ROOT/edge_simulator"
SIM_BIN="$SIM_DIR/build/gridguard_simulator"

BROKER_HOST="${GRIDGUARD_MQTT_HOST:-localhost}"
BROKER_PORT="${GRIDGUARD_MQTT_PORT:-1883}"
HTTP_HOST="${GRIDGUARD_HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${GRIDGUARD_HTTP_PORT:-8080}"

START_SIM=1
if [ "${1:-}" = "--no-sim" ]; then
    START_SIM=0
fi

PIDS=""   # space-separated list of child PIDs owned by this script

cleanup() {
    echo ""
    echo "  [run] shutting down..."
    for pid in $PIDS; do
        kill "$pid" 2>/dev/null
    done
    wait 2>/dev/null
    echo "  [run] stopped."
}
trap cleanup INT TERM

# --- 1. Mosquitto MQTT broker -------------------------------------------
if nc -z "$BROKER_HOST" "$BROKER_PORT" >/dev/null 2>&1; then
    echo "  [run] Mosquitto already running on $BROKER_HOST:$BROKER_PORT"
else
    MOSQUITTO_BIN="$(command -v mosquitto || true)"
    if [ -z "$MOSQUITTO_BIN" ] && [ -x /usr/local/sbin/mosquitto ]; then
        MOSQUITTO_BIN=/usr/local/sbin/mosquitto   # Homebrew (Intel macOS)
    fi
    if [ -z "$MOSQUITTO_BIN" ]; then
        echo "  [run] ERROR: mosquitto not found — install it with:" >&2
        echo "         brew install mosquitto" >&2
        exit 1
    fi
    echo "  [run] starting Mosquitto broker..."
    "$MOSQUITTO_BIN" &
    PIDS="$PIDS $!"
    # Wait for the listener to come up (max 10 s)
    i=0
    while [ "$i" -lt 20 ] && ! nc -z "$BROKER_HOST" "$BROKER_PORT" >/dev/null 2>&1; do
        sleep 0.5
        i=$((i + 1))
    done
    if ! nc -z "$BROKER_HOST" "$BROKER_PORT" >/dev/null 2>&1; then
        echo "  [run] ERROR: broker did not come up on port $BROKER_PORT" >&2
        exit 1
    fi
fi

# --- 2. Python virtualenv (backend/venv) --------------------------------
if [ ! -x "$SCRIPT_DIR/venv/bin/python" ]; then
    echo "  [run] creating Python venv (first run only)..."
    python3 -m venv "$SCRIPT_DIR/venv"
    "$SCRIPT_DIR/venv/bin/pip" install --quiet --upgrade pip
    "$SCRIPT_DIR/venv/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"
fi
# Ensure the MQTT client is present (no-op when already installed)
if ! "$SCRIPT_DIR/venv/bin/python" -c "import paho.mqtt.client" >/dev/null 2>&1; then
    "$SCRIPT_DIR/venv/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"
fi

# --- 3. Backend bridge (REST/SSE API + dashboard hosting) ---------------
# Kill any stale backend process from a previous run that still holds port 8080.
if nc -z "$HTTP_HOST" "$HTTP_PORT" >/dev/null 2>&1; then
    echo "  [run] port $HTTP_PORT is occupied — cleaning up stale process..."
    # Find and kill the process listening on the HTTP port.
    STALE_PID=$(lsof -ti :"$HTTP_PORT" 2>/dev/null || true)
    if [ -n "$STALE_PID" ]; then
        kill $STALE_PID 2>/dev/null
        sleep 1
        # Force-kill if it survived SIGTERM.
        if nc -z "$HTTP_HOST" "$HTTP_PORT" >/dev/null 2>&1; then
            kill -9 $STALE_PID 2>/dev/null
            sleep 0.5
        fi
    fi
    if nc -z "$HTTP_HOST" "$HTTP_PORT" >/dev/null 2>&1; then
        echo "  [run] ERROR: could not free port $HTTP_PORT" >&2
        exit 1
    fi
    echo "  [run] port $HTTP_PORT freed."
fi

echo "  [run] starting backend + dashboard on http://$HTTP_HOST:$HTTP_PORT/ ..."
(cd "$SCRIPT_DIR" && exec ./venv/bin/python server.py) &
PIDS="$PIDS $!"

# Wait for the backend to come up (max 10 s)
i=0
while [ "$i" -lt 20 ] && ! nc -z "$HTTP_HOST" "$HTTP_PORT" >/dev/null 2>&1; do
    sleep 0.5
    i=$((i + 1))
done
if ! nc -z "$HTTP_HOST" "$HTTP_PORT" >/dev/null 2>&1; then
    echo "  [run] ERROR: backend did not come up on port $HTTP_PORT" >&2
    exit 1
fi

# --- 4. C++ edge simulator ----------------------------------------------
if [ "$START_SIM" -eq 1 ]; then
    if [ -x "$SIM_BIN" ]; then
        echo "  [run] starting C++ edge simulator (topic: gridguard/telemetry)..."
        (cd "$SIM_DIR" && exec ./build/gridguard_simulator data/device_config.json) &
        PIDS="$PIDS $!"
    else
        echo "  [run] NOTE: simulator binary not found ($SIM_BIN)"
        echo "        build it first with:"
        echo "          cd edge_simulator && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j"
    fi
fi

echo ""
echo "  ============================================================"
echo "   GridGuard AI is running."
echo "     Dashboard : http://$HTTP_HOST:$HTTP_PORT/"
echo "     API state : http://$HTTP_HOST:$HTTP_PORT/api/state"
echo "     SSE stream: http://$HTTP_HOST:$HTTP_PORT/api/events"
echo "   Press Ctrl+C to stop."
echo "  ============================================================"
echo ""

wait
