# ========================================================================
# GRIDGUARD AI — backend/config.py
# ========================================================================
# Central configuration for the GridGuard AI backend bridge.
#
# Data flow:
#   C++ edge_simulator  →  Mosquitto MQTT  →  this backend  →  SQLite
#   →  REST/SSE API     →  existing frontend (frontend/assets/js/data.js)
#
# Every value can be overridden with an environment variable so the
# demo can be reconfigured without editing code.
# ========================================================================

import os

# ------------------------------------------------------------------
# MQTT (matches edge_simulator/src/Simulator.cpp)
# ------------------------------------------------------------------
MQTT_BROKER_HOST = os.environ.get("GRIDGUARD_MQTT_HOST", "localhost")
MQTT_BROKER_PORT = int(os.environ.get("GRIDGUARD_MQTT_PORT", "1883"))
MQTT_TOPIC       = os.environ.get("GRIDGUARD_MQTT_TOPIC", "gridguard/telemetry")
MQTT_CLIENT_ID   = os.environ.get("GRIDGUARD_MQTT_CLIENT_ID", "gridguard-backend-bridge")

# ------------------------------------------------------------------
# HTTP server (REST + SSE + static frontend hosting)
# ------------------------------------------------------------------
HTTP_HOST = os.environ.get("GRIDGUARD_HTTP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("GRIDGUARD_HTTP_PORT", "8080"))

# ------------------------------------------------------------------
# Paths
# ------------------------------------------------------------------
BACKEND_DIR       = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT      = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR      = os.path.join(PROJECT_ROOT, "frontend")
SIMULATOR_CONFIG  = os.path.join(PROJECT_ROOT, "edge_simulator", "data", "device_config.json")
DB_PATH           = os.environ.get("GRIDGUARD_DB", os.path.join(BACKEND_DIR, "gridguard.db"))

# ------------------------------------------------------------------
# Chart history sampling
#   One chart point is stored every CHART_INTERVAL_SECONDS, built from
#   the latest real telemetry aggregates. The API serves the most
#   recent CHART_MAX_POINTS points.
# ------------------------------------------------------------------
CHART_INTERVAL_SECONDS = int(os.environ.get("GRIDGUARD_CHART_INTERVAL", "5"))
CHART_MAX_POINTS       = 48

# ------------------------------------------------------------------
# Security-event generator (port of the frontend's simulation.js
# intrusion logic — the C++ simulator does not emit security events).
#   Every INTRUSION_INTERVAL_SECONDS there is an
#   INTRUSION_PROBABILITY chance that one intrusion event is raised.
# ------------------------------------------------------------------
INTRUSION_INTERVAL_SECONDS = int(os.environ.get("GRIDGUARD_INTRUSION_INTERVAL", "30"))
INTRUSION_PROBABILITY      = float(os.environ.get("GRIDGUARD_INTRUSION_PROBABILITY", "0.12"))

# ------------------------------------------------------------------
# Retention
# ------------------------------------------------------------------
TELEMETRY_MAX_ROWS    = 10000   # raw telemetry rows kept in SQLite
EVENT_LIST_LIMIT      = 50      # anomalies / intrusions returned by /api/state

# ------------------------------------------------------------------
# Demo authentication credentials
#   Used by POST /api/login.  This is a local hackathon demo — do NOT
#   use these for anything beyond the demo environment.
# ------------------------------------------------------------------
DEMO_USERS = {
    "admin@gridguard.ai": {
        "password": "admin123",
        "name":     "Admin",
        "email":    "admin@gridguard.ai",
        "role":     "Administrator",
    }
}
