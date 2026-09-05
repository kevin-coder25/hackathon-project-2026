# ========================================================================
# GRIDGUARD AI — backend/db.py
# ========================================================================
# SQLite persistence layer for the GridGuard AI backend.
#
# Stores:
#   • device registry (latest state of every device seen on MQTT)
#   • raw telemetry history
#   • anomalies, intrusions, alerts, activity events
#   • chart history points
#   • counters and settings
#
# The connection is shared between the MQTT bridge thread and the HTTP
# server threads, so every access is serialized with a re-entrant lock
# (SQLite itself is compiled thread-safe here, but one connection is
# not safe for concurrent use without external locking).
# ========================================================================

import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    device_id      TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    location       TEXT NOT NULL DEFAULT '',
    type           TEXT NOT NULL DEFAULT 'Unknown',
    sector         TEXT NOT NULL DEFAULT '',
    voltage        REAL NOT NULL DEFAULT 0,
    current        REAL NOT NULL DEFAULT 0,
    power          REAL NOT NULL DEFAULT 0,
    temperature    REAL NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'unknown',
    first_seen_ms  INTEGER NOT NULL DEFAULT 0,
    last_seen_ms   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS telemetry (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id     TEXT NOT NULL,
    voltage       REAL,
    current       REAL,
    power         REAL,
    temperature   REAL,
    status        TEXT,
    severity      TEXT,
    anomaly_type  TEXT,
    timestamp_ms  INTEGER,
    received_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device ON telemetry(device_id, timestamp_ms);

CREATE TABLE IF NOT EXISTS anomalies (
    id             TEXT PRIMARY KEY,   -- e.g. 'ANM-0001'
    device_id      TEXT NOT NULL,
    type           TEXT NOT NULL,      -- display label, e.g. 'Voltage Spike'
    severity       TEXT NOT NULL,      -- 'critical' | 'warning' | 'info'
    description    TEXT NOT NULL,
    confidence     REAL NOT NULL,      -- rule-based detection score (0-100)
    status         TEXT NOT NULL,      -- 'active' | 'investigating' | 'resolved'
    detected_ms    INTEGER NOT NULL,
    last_seen_ms   INTEGER NOT NULL,
    resolved_ms    INTEGER
);

CREATE TABLE IF NOT EXISTS intrusions (
    id            TEXT PRIMARY KEY,    -- e.g. 'IDS-0001'
    device_id     TEXT NOT NULL,
    type          TEXT NOT NULL,
    severity      TEXT NOT NULL,
    source_ip     TEXT NOT NULL,
    action        TEXT NOT NULL,
    timestamp_ms  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    severity      TEXT NOT NULL,
    device_id     TEXT NOT NULL,
    type          TEXT NOT NULL,
    description   TEXT NOT NULL,
    status        TEXT NOT NULL,
    timestamp_ms  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    icon          TEXT NOT NULL,       -- 'ok' | 'warning' | 'critical' | 'settings'
    title         TEXT NOT NULL,
    detail        TEXT NOT NULL,
    timestamp_ms  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chart_points (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    label             TEXT NOT NULL,           -- 'HH:MM'
    power_consumption REAL,                    -- total W across online devices
    power_generation  REAL,                    -- NULL: not measured (see README)
    voltage           REAL,                    -- average V
    current           REAL,                    -- total A
    temp_a            REAL,                    -- average °C of first device group
    temp_b            REAL,                    -- average °C of second device group
    timestamp_ms      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_SETTINGS = {
    "refreshInterval": "5",
    "sensitivity": "medium",
    "confidence": "90",
}


def _now_ms():
    import time
    return int(time.time() * 1000)


class Database:
    """Thread-safe wrapper around a single SQLite connection."""

    def __init__(self, path):
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()
            self._ensure_defaults()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _ensure_defaults(self):
        for key, value in DEFAULT_SETTINGS.items():
            self._conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
                (key, value),
            )
        for key in ("anomalyId", "intrusionId", "threatsBlocked"):
            self._conn.execute(
                "INSERT OR IGNORE INTO counters(key, value) VALUES (?, 0)",
                (key,),
            )
        self._conn.commit()

    def _query_all(self, sql, params=()):
        with self._lock:
            cur = self._conn.execute(sql, params)
            return cur.fetchall()

    def _query_one(self, sql, params=()):
        with self._lock:
            cur = self._conn.execute(sql, params)
            return cur.fetchone()

    def _execute(self, sql, params=()):
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    # ------------------------------------------------------------------
    # Devices
    # ------------------------------------------------------------------
    def get_device(self, device_id):
        return self._query_one(
            "SELECT * FROM devices WHERE device_id = ?", (device_id,)
        )

    def get_devices(self):
        return self._query_all("SELECT * FROM devices ORDER BY device_id")

    def upsert_device(self, device_id, name, location, dev_type, sector,
                      voltage, current, power, temperature, status, seen_ms):
        with self._lock:
            existing = self.get_device(device_id)
            if existing is None:
                self._execute(
                    """INSERT INTO devices (device_id, name, location, type, sector,
                         voltage, current, power, temperature, status,
                         first_seen_ms, last_seen_ms)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (device_id, name, location, dev_type, sector,
                     voltage, current, power, temperature, status,
                     seen_ms, seen_ms),
                )
            else:
                # Keep the first-registered metadata unless the new
                # reading provides it.
                self._execute(
                    """UPDATE devices SET
                         name = ?, location = ?, type = ?, sector = ?,
                         voltage = ?, current = ?, power = ?, temperature = ?,
                         status = ?, last_seen_ms = ?
                       WHERE device_id = ?""",
                    (name or existing["name"],
                     location or existing["location"],
                     dev_type or existing["type"],
                     sector or existing["sector"],
                     voltage, current, power, temperature, status, seen_ms,
                     device_id),
                )

    # ------------------------------------------------------------------
    # Telemetry history
    # ------------------------------------------------------------------
    def insert_telemetry(self, device_id, voltage, current, power,
                         temperature, status, severity, anomaly_type,
                         timestamp_ms, received_ms):
        self._execute(
            """INSERT INTO telemetry (device_id, voltage, current, power,
                 temperature, status, severity, anomaly_type,
                 timestamp_ms, received_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (device_id, voltage, current, power, temperature, status,
             severity, anomaly_type, timestamp_ms, received_ms),
        )

    def prune_telemetry(self, max_rows):
        self._execute(
            """DELETE FROM telemetry WHERE id <= (
                   SELECT MIN(id) FROM (
                       SELECT id FROM telemetry ORDER BY id DESC LIMIT ?
                   )
               )""",
            (max_rows,),
        )

    def count_telemetry(self):
        row = self._query_one("SELECT COUNT(*) AS n FROM telemetry")
        return row["n"] if row else 0

    # ------------------------------------------------------------------
    # Anomalies
    # ------------------------------------------------------------------
    def next_anomaly_id(self):
        """Reserve and return the next 'ANM-XXXX' id."""
        with self._lock:
            row = self._query_one(
                "SELECT value FROM counters WHERE key = 'anomalyId'"
            )
            n = (row["value"] if row else 0) + 1
            self._execute(
                "UPDATE counters SET value = ? WHERE key = 'anomalyId'", (n,)
            )
            return "ANM-%04d" % n

    def insert_anomaly(self, anomaly_id, device_id, type_label, severity,
                       description, confidence, status, detected_ms, last_seen_ms):
        self._execute(
            """INSERT INTO anomalies (id, device_id, type, severity, description,
                 confidence, status, detected_ms, last_seen_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (anomaly_id, device_id, type_label, severity, description,
             confidence, status, detected_ms, last_seen_ms),
        )

    def get_active_anomaly(self, device_id, type_label):
        return self._query_one(
            """SELECT * FROM anomalies
               WHERE device_id = ? AND type = ? AND status != 'resolved'
               ORDER BY detected_ms DESC LIMIT 1""",
            (device_id, type_label),
        )

    def get_active_anomalies_for_device(self, device_id):
        return self._query_all(
            """SELECT * FROM anomalies
               WHERE device_id = ? AND status != 'resolved'
               ORDER BY detected_ms DESC""",
            (device_id,),
        )

    def touch_anomaly(self, anomaly_id, seen_ms):
        self._execute(
            "UPDATE anomalies SET last_seen_ms = ? WHERE id = ?",
            (seen_ms, anomaly_id),
        )

    def resolve_anomaly(self, anomaly_id, resolved_ms):
        self._execute(
            "UPDATE anomalies SET status = 'resolved', resolved_ms = ? WHERE id = ?",
            (resolved_ms, anomaly_id),
        )

    def get_anomalies(self, limit=50):
        return self._query_all(
            "SELECT * FROM anomalies ORDER BY detected_ms DESC LIMIT ?", (limit,)
        )

    # ------------------------------------------------------------------
    # Intrusions
    # ------------------------------------------------------------------
    def next_intrusion_id(self):
        with self._lock:
            row = self._query_one(
                "SELECT value FROM counters WHERE key = 'intrusionId'"
            )
            n = (row["value"] if row else 0) + 1
            self._execute(
                "UPDATE counters SET value = ? WHERE key = 'intrusionId'", (n,)
            )
            return "IDS-%04d" % n

    def insert_intrusion(self, intrusion_id, device_id, type_label, severity,
                         source_ip, action, timestamp_ms):
        self._execute(
            """INSERT INTO intrusions (id, device_id, type, severity,
                 source_ip, action, timestamp_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (intrusion_id, device_id, type_label, severity, source_ip,
             action, timestamp_ms),
        )

    def get_intrusions(self, limit=50):
        return self._query_all(
            "SELECT * FROM intrusions ORDER BY timestamp_ms DESC LIMIT ?", (limit,)
        )

    # ------------------------------------------------------------------
    # Alerts / activity
    # ------------------------------------------------------------------
    def insert_alert(self, severity, device_id, type_label, description,
                     status, timestamp_ms):
        self._execute(
            """INSERT INTO alerts (severity, device_id, type, description,
                 status, timestamp_ms)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (severity, device_id, type_label, description, status, timestamp_ms),
        )

    def get_alerts(self, limit=30):
        return self._query_all(
            "SELECT * FROM alerts ORDER BY timestamp_ms DESC, id DESC LIMIT ?",
            (limit,),
        )

    def insert_activity(self, icon, title, detail, timestamp_ms):
        self._execute(
            "INSERT INTO activity (icon, title, detail, timestamp_ms) VALUES (?, ?, ?, ?)",
            (icon, title, detail, timestamp_ms),
        )

    def get_activity(self, limit=30):
        return self._query_all(
            "SELECT * FROM activity ORDER BY timestamp_ms DESC, id DESC LIMIT ?",
            (limit,),
        )

    # ------------------------------------------------------------------
    # Chart points
    # ------------------------------------------------------------------
    def insert_chart_point(self, label, power_consumption, power_generation,
                           voltage, current, temp_a, temp_b, timestamp_ms):
        self._execute(
            """INSERT INTO chart_points (label, power_consumption,
                 power_generation, voltage, current, temp_a, temp_b,
                 timestamp_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (label, power_consumption, power_generation, voltage, current,
             temp_a, temp_b, timestamp_ms),
        )

    def get_chart_points(self, limit=48):
        """Return the most recent `limit` points in chronological order."""
        rows = self._query_all(
            """SELECT * FROM (
                   SELECT * FROM chart_points
                   ORDER BY timestamp_ms DESC, id DESC LIMIT ?
               ) ORDER BY timestamp_ms ASC, id ASC""",
            (limit,),
        )
        return rows

    def prune_chart_points(self, max_rows):
        self._execute(
            """DELETE FROM chart_points WHERE id <= (
                   SELECT MIN(id) FROM (
                       SELECT id FROM chart_points ORDER BY id DESC LIMIT ?
                   )
               )""",
            (max_rows,),
        )

    # ------------------------------------------------------------------
    # Counters / settings
    # ------------------------------------------------------------------
    def get_counters(self):
        rows = self._query_all("SELECT key, value FROM counters")
        result = {"anomalyId": 0, "intrusionId": 0, "threatsBlocked": 0}
        for row in rows:
            result[row["key"]] = row["value"]
        # alertId is used by the frontend state shape; derive from rows
        row = self._query_one("SELECT COUNT(*) AS n FROM alerts")
        result["alertId"] = (row["n"] if row else 0) + 1
        return result

    def increment_threats_blocked(self):
        self._execute(
            """UPDATE counters SET value = value + 1
               WHERE key = 'threatsBlocked'"""
        )

    def get_settings(self):
        rows = self._query_all("SELECT key, value FROM settings")
        result = {"refreshInterval": 5, "sensitivity": "medium", "confidence": 90}
        for row in rows:
            key = row["key"]
            if key in result:
                try:
                    result[key] = int(row["value"])
                except (TypeError, ValueError):
                    result[key] = row["value"]
        return result

    def update_settings(self, partial):
        for key, value in partial.items():
            if key in DEFAULT_SETTINGS:
                self._execute(
                    "INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)",
                    (key, str(value)),
                )
        return self.get_settings()

    # ------------------------------------------------------------------
    # Reset (mirrors GridGuardData.reset() for the Settings page button)
    # ------------------------------------------------------------------
    def reset_events(self):
        """Clear all events and history. The device registry is kept —
        devices refresh automatically from the next MQTT message."""
        with self._lock:
            for table in ("telemetry", "anomalies", "intrusions", "alerts",
                          "activity", "chart_points", "settings"):
                self._conn.execute("DELETE FROM " + table)
            self._conn.execute("DELETE FROM counters")
            self._conn.commit()
            self._ensure_defaults()

    def close(self):
        with self._lock:
            self._conn.close()
