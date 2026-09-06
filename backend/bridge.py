# ========================================================================
# GRIDGUARD AI — backend/bridge.py
# ========================================================================
# MQTT → SQLite bridge.
#
# Responsibilities:
#   1. Subscribe to the simulator's telemetry topic on Mosquitto
#      (topic: gridguard/telemetry — same as edge_simulator).
#   2. Translate each C++ telemetry JSON message into the frontend's
#      data shape (see frontend/assets/js/data.js buildInitialState).
#   3. Maintain the device registry and raw telemetry history in SQLite.
#   4. Derive anomaly *episodes* from telemetry severity flags — one
#      anomaly record per (device, type) episode, never one per message.
#      Episodes are auto-resolved when telemetry returns to NORMAL.
#   5. Run the security-event (intrusion) generator — a faithful port of
#      the frontend's simulation.js logic, since the C++ simulator does
#      not emit security events.
#   6. Sample chart-history points from real telemetry aggregates.
#   7. Notify SSE subscribers whenever the live state changes.
#
# Field-mapping notes (C++ → frontend):
#   device_id  → deviceId          location → location (unchanged)
#   severity   → NORMAL/WARNING/CRITICAL → critical/warning/info
#   anomaly_type → snake_case → Title Case display label
#   timestamp  → ISO-8601 string → epoch milliseconds
#
# Values that the simulator does NOT measure are never faked:
#   • frequency      → reported as 0 (dashboard requires a number; the
#                      simulator does not measure grid frequency)
#   • powerGeneration→ NULL in chart points (generation is not metered
#                      separately from consumption)
# See backend/README.md for the full list of limitations.
# ========================================================================

import datetime
import json
import queue
import random
import threading
import time

import paho.mqtt.client as mqtt

import config
from db import Database

# ------------------------------------------------------------------
# Translation tables
# ------------------------------------------------------------------

ANOMALY_TYPE_LABELS = {
    "voltage_spike":    "Voltage Spike",
    "voltage_drop":     "Voltage Drop",
    "high_current":     "High Current",
    "excessive_power":  "Excessive Power",
    "high_temperature": "High Temperature",
    "device_offline":   "Device Offline",
}

SEVERITY_MAP = {
    "CRITICAL": "critical",
    "WARNING":  "warning",
    "NORMAL":   "info",
}

# Security-event vocabulary — ported verbatim from the frontend's
# simulation.js (INTRUSION_TYPES / ATTACK_IPS) so live-mode security
# logs keep the exact same look & feel as the original dashboard.
INTRUSION_TYPES = [
    "Unauthorized Access Attempt", "Suspicious Traffic",
    "Abnormal Device Activity", "Authentication Failure",
    "Configuration Change",
]

ATTACK_IPS = [
    "203.0.113.87", "198.51.100.23", "192.0.2.140",
    "198.51.100.77", "203.0.113.29", "192.0.2.88",
    "203.0.113.150", "192.0.2.31", "198.51.100.200",
]


def now_ms():
    return int(time.time() * 1000)


def parse_timestamp_ms(value, fallback_ms=None):
    """Parse the simulator's ISO-8601 timestamp into epoch milliseconds.

    The C++ simulator formats timestamps with std::localtime() but
    suffixes them with 'Z' (see Device::currentTimestamp).  To keep the
    dashboard clock aligned with wall-clock time we therefore parse the
    string as *local* time, ignoring the misleading 'Z'.
    """
    if fallback_ms is None:
        fallback_ms = now_ms()
    if not value:
        return fallback_ms
    s = str(value).strip()
    try:
        if s.endswith("Z"):
            s = s[:-1]
        dt = datetime.datetime.fromisoformat(s)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return fallback_ms


def derive_sector(location):
    """'Sector A-1' → 'A-1' (the frontend expects the short sector id)."""
    if not location:
        return ""
    if location.lower().startswith("sector "):
        return location[len("sector "):]
    return location


def clamp(value, lo, hi):
    return lo if value < lo else hi if value > hi else value


class Bridge:
    """Owns the database, the MQTT connection and the background loops."""

    def __init__(self, database):
        self.db = database
        self._lock = threading.RLock()      # serialises composite state ops
        self._stop = threading.Event()
        self._subscribers = []              # SSE client queues
        self._last_notify_ms = 0
        self._mqtt_connected = False
        self._device_meta = self._load_device_meta()
        self._rng = random.Random()

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=config.MQTT_CLIENT_ID,
        )
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        self._client.reconnect_delay_set(min_delay=1, max_delay=10)

    # ------------------------------------------------------------------
    # Device metadata from the simulator's own configuration
    # (single source of truth — no duplicated device definitions)
    # ------------------------------------------------------------------
    def _load_device_meta(self):
        meta = {}
        try:
            with open(config.SIMULATOR_CONFIG, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            for dev in cfg.get("devices", []):
                meta[dev.get("device_id")] = {
                    "type": dev.get("type", ""),
                    "base_voltage": float(dev.get("base_voltage", 230.0)),
                    "base_current": float(dev.get("base_current", 18.0)),
                    "base_temperature": float(dev.get("base_temperature", 55.0)),
                }
        except (OSError, ValueError) as exc:
            print("  [bridge] warning: could not read simulator config (%s) "
                  "— devices will use telemetry-only metadata" % exc)
        return meta

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self):
        print("  [bridge] connecting to MQTT broker %s:%s (topic: %s)..."
              % (config.MQTT_BROKER_HOST, config.MQTT_BROKER_PORT,
                 config.MQTT_TOPIC))
        try:
            self._client.connect_async(
                config.MQTT_BROKER_HOST, config.MQTT_BROKER_PORT)
            self._client.loop_start()
        except Exception as exc:                    # pragma: no cover
            print("  [bridge] MQTT connect failed: %s" % exc)

        self._chart_thread = threading.Thread(
            target=self._chart_loop, name="chart-loop", daemon=True)
        self._intrusion_thread = threading.Thread(
            target=self._intrusion_loop, name="intrusion-loop", daemon=True)
        self._chart_thread.start()
        self._intrusion_thread.start()

    def stop(self):
        self._stop.set()
        try:
            self._client.disconnect()
            self._client.loop_stop()
        except Exception:
            pass

    def is_mqtt_connected(self):
        return self._mqtt_connected

    # ------------------------------------------------------------------
    # MQTT callbacks
    # ------------------------------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            self._mqtt_connected = True
            client.subscribe(config.MQTT_TOPIC, qos=0)
            print("  [bridge] MQTT connected — subscribed to '%s'"
                  % config.MQTT_TOPIC)
        else:
            self._mqtt_connected = False
            print("  [bridge] MQTT connection refused: %s" % reason_code)

    def _on_disconnect(self, client, userdata, *args):
        self._mqtt_connected = False
        if not self._stop.is_set():
            print("  [bridge] MQTT disconnected — reconnecting...")

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            if not isinstance(data, dict):
                return
        except (ValueError, UnicodeDecodeError):
            return

        try:
            with self._lock:
                self._process_telemetry(data)
        except Exception as exc:                    # never kill the loop
            print("  [bridge] error processing telemetry: %s" % exc)

        self._maybe_notify()

    # ------------------------------------------------------------------
    # Telemetry processing (the heart of the bridge)
    # ------------------------------------------------------------------
    def _process_telemetry(self, data):
        device_id = str(data.get("device_id", "")).strip()
        if not device_id:
            return

        received_ms = now_ms()
        ts_ms = parse_timestamp_ms(data.get("timestamp"), received_ms)

        location   = str(data.get("location", "") or "")
        voltage    = float(data.get("voltage") or 0)
        current    = float(data.get("current") or 0)
        power      = float(data.get("power") or 0)
        temperature = float(data.get("temperature") or 0)
        status     = str(data.get("status", "") or "").lower()
        severity_raw = str(data.get("severity", "") or "NORMAL").upper()
        anomaly_type = str(data.get("anomaly_type", "") or "")

        meta = self._device_meta.get(device_id, {})
        dev_type = meta.get("type") or ""
        # Display name: the simulator only transmits machine ids, so the
        # device *type* from its own config file is used as the name.
        dev_name = dev_type or device_id
        sector = derive_sector(location)

        prev = self.db.get_device(device_id)
        prev_status = prev["status"] if prev else None

        # --- 1. Update the device registry ----------------------------
        self.db.upsert_device(
            device_id, dev_name, location, dev_type, sector,
            voltage, current, power, temperature,
            status or (prev_status or "unknown"), received_ms,
        )

        # --- 2. Store raw telemetry ------------------------------------
        self.db.insert_telemetry(
            device_id, voltage, current, power, temperature,
            status, severity_raw, anomaly_type, ts_ms, received_ms,
        )

        # --- 3. Anomaly episode handling (deduplicated) ----------------
        # The simulator flags anomaly_type on EVERY reading while an
        # anomaly is active (up to 5 ticks). We create exactly ONE
        # anomaly record per (device, type) episode and resolve it when
        # a clean reading arrives.
        had_active = self.db.get_active_anomalies_for_device(device_id)

        if anomaly_type:
            label = ANOMALY_TYPE_LABELS.get(anomaly_type, anomaly_type.title())
            severity = SEVERITY_MAP.get(severity_raw, "info")

            existing = self.db.get_active_anomaly(device_id, label)
            if existing:
                # Same episode continues — refresh last-seen only.
                self.db.touch_anomaly(existing["id"], ts_ms)
            else:
                confidence = self._confidence(
                    anomaly_type, voltage, current, power, temperature, meta)
                description = self._describe(
                    anomaly_type, device_id, voltage, current, power, temperature)
                status_val = "active" if severity == "critical" else "investigating"

                anomaly_id = self.db.next_anomaly_id()
                self.db.insert_anomaly(
                    anomaly_id, device_id, label, severity, description,
                    confidence, status_val, ts_ms, ts_ms)

                # Alert + activity (mirrors simulation.js behaviour)
                self.db.insert_alert(
                    severity, device_id, label, description, status_val, ts_ms)
                icon = ("critical" if severity == "critical"
                        else "warning" if severity == "warning" else "ok")
                self.db.insert_activity(
                    icon, "%s on %s" % (label, device_id), description, ts_ms)
        else:
            # Clean reading — resolve any open episodes for this device.
            for anomaly in had_active:
                self.db.resolve_anomaly(anomaly["id"], ts_ms)
                self.db.insert_activity(
                    "ok",
                    "%s on %s resolved" % (anomaly["type"], device_id),
                    "Telemetry returned to normal range",
                    ts_ms)

        # --- 4. Status-transition activity -----------------------------
        # Only log plain transitions that are not already covered by an
        # anomaly episode (device_offline covers its own transition).
        if (prev_status is not None and prev_status != status
                and not anomaly_type and not had_active):
            if status == "offline":
                self.db.insert_activity(
                    "critical", "Device %s went offline" % device_id,
                    "Telemetry lost — device unreachable", ts_ms)
            elif prev_status == "offline" and status == "online":
                self.db.insert_activity(
                    "ok", "Device %s came online" % device_id,
                    "Telemetry stream resumed", ts_ms)

    # ------------------------------------------------------------------
    # Anomaly helpers
    # ------------------------------------------------------------------
    def _confidence(self, anomaly_type, voltage, current, power,
                    temperature, meta):
        """Rule-based detection confidence (0–100), derived from how far
        the real telemetry deviates from the device's nominal baseline
        (baselines come from edge_simulator/data/device_config.json)."""
        base_v = meta.get("base_voltage", 230.0)
        base_i = meta.get("base_current", 18.0)
        base_t = meta.get("base_temperature", 55.0)

        if anomaly_type == "voltage_spike":
            overshoot = max(0.0, (voltage - base_v) / base_v * 100.0)
            return round(clamp(85.0 + overshoot * 1.5, 85.0, 99.0), 1)
        if anomaly_type == "voltage_drop":
            undershoot = max(0.0, (base_v - voltage) / base_v * 100.0)
            return round(clamp(85.0 + undershoot * 1.5, 85.0, 99.0), 1)
        if anomaly_type == "high_current":
            over = max(0.0, (current - base_i) / base_i * 100.0)
            return round(clamp(85.0 + over * 1.2, 85.0, 99.0), 1)
        if anomaly_type == "excessive_power":
            base_p = base_v * base_i
            over = max(0.0, (power - base_p) / base_p * 100.0) if base_p else 0.0
            return round(clamp(85.0 + over * 1.2, 85.0, 99.0), 1)
        if anomaly_type == "high_temperature":
            excess = max(0.0, temperature - base_t)
            return round(clamp(85.0 + excess * 0.7, 85.0, 99.0), 1)
        if anomaly_type == "device_offline":
            return 99.0
        return 90.0

    def _describe(self, anomaly_type, device_id, voltage, current, power,
                  temperature):
        """Human-readable descriptions built from the real readings."""
        if anomaly_type == "voltage_spike":
            return "Voltage spike detected on %s (%.2f V)" % (device_id, voltage)
        if anomaly_type == "voltage_drop":
            return "Voltage drop on %s (%.2f V)" % (device_id, voltage)
        if anomaly_type == "high_current":
            return "Current exceeded safe threshold on %s (%.2f A)" % (device_id, current)
        if anomaly_type == "excessive_power":
            return "Power consumption anomaly on %s (%.2f W)" % (device_id, power)
        if anomaly_type == "high_temperature":
            return "Temperature above threshold on %s (%.2f °C)" % (device_id, temperature)
        if anomaly_type == "device_offline":
            return "%s went offline unexpectedly" % device_id
        return "Anomaly detected on %s" % device_id

    # ------------------------------------------------------------------
    # Chart-history loop
    # ------------------------------------------------------------------
    def _chart_loop(self):
        while not self._stop.wait(config.CHART_INTERVAL_SECONDS):
            try:
                with self._lock:
                    self._sample_chart_point()
            except Exception as exc:
                print("  [bridge] chart sampling error: %s" % exc)

    def _sample_chart_point(self):
        devices = self.db.get_devices()
        online = [d for d in devices if d["status"] != "offline"]
        if not online:
            return

        total_power = sum(d["power"] for d in online)
        avg_voltage = sum(d["voltage"] for d in online) / len(online)
        total_current = sum(d["current"] for d in online)

        # Mirror the frontend: first group of devices → tempA, rest → tempB
        ordered = sorted(devices, key=lambda d: d["device_id"])
        group_a = [d for d in ordered[:3] if d["status"] != "offline"]
        group_b = [d for d in ordered[3:] if d["status"] != "offline"]
        temp_a = (sum(d["temperature"] for d in group_a) / len(group_a)
                  if group_a else None)
        temp_b = (sum(d["temperature"] for d in group_b) / len(group_b)
                  if group_b else None)

        ts = now_ms()
        label = datetime.datetime.fromtimestamp(ts / 1000.0).strftime("%H:%M")
        self.db.insert_chart_point(
            label, round(total_power, 2), None,          # generation: not metered
            round(avg_voltage, 2), round(total_current, 2),
            round(temp_a, 2) if temp_a is not None else None,
            round(temp_b, 2) if temp_b is not None else None,
            ts,
        )

    # ------------------------------------------------------------------
    # Security-event generator (port of simulation.js intrusions)
    # ------------------------------------------------------------------
    def _intrusion_loop(self):
        while not self._stop.wait(config.INTRUSION_INTERVAL_SECONDS):
            try:
                if self._rng.random() < config.INTRUSION_PROBABILITY:
                    with self._lock:
                        self._generate_intrusion()
                        self._maybe_notify(force=True)
            except Exception as exc:
                print("  [bridge] intrusion generator error: %s" % exc)

    def _generate_intrusion(self):
        devices = self.db.get_devices()
        if not devices:
            return
        target = self._rng.choice(devices)

        evt_type = self._rng.choice(INTRUSION_TYPES)
        source_ip = self._rng.choice(ATTACK_IPS)

        roll = self._rng.random()
        severity = "critical" if roll < 0.25 else "warning" if roll < 0.60 else "info"
        action = ("Blocked" if severity == "critical"
                  else "Monitored" if severity == "warning" else "Logged")

        ts = now_ms()
        intrusion_id = self.db.next_intrusion_id()
        self.db.insert_intrusion(
            intrusion_id, target["device_id"], evt_type, severity,
            source_ip, action, ts)

        description = "%s from %s on %s" % (evt_type, source_ip, target["device_id"])
        self.db.insert_alert(
            severity, target["device_id"], "Security", description,
            action.lower(), ts)
        self.db.insert_activity(
            "critical" if severity == "critical" else "warning",
            "Security: %s on %s" % (evt_type, target["device_id"]),
            "Source: %s — Action: %s" % (source_ip, action),
            ts)

        if severity == "critical":
            self.db.increment_threats_blocked()

    # ------------------------------------------------------------------
    # SSE subscriber management
    # ------------------------------------------------------------------
    def add_subscriber(self):
        q = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.append(q)
        return q

    def remove_subscriber(self, q):
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _maybe_notify(self, force=False):
        """Push a 'tick' notification to all SSE subscribers.

        Throttled to at most one notification per second so the five
        messages of one simulator tick coalesce into a single event.
        """
        now = now_ms()
        if not force and (now - self._last_notify_ms) < 1000:
            return
        self._last_notify_ms = now

        payload = json.dumps({"type": "tick", "ts": now})
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass

    # ------------------------------------------------------------------
    # Maintenance loop work (called by server periodically)
    # ------------------------------------------------------------------
    def prune(self):
        with self._lock:
            self.db.prune_telemetry(config.TELEMETRY_MAX_ROWS)
            self.db.prune_chart_points(config.CHART_MAX_POINTS * 10)

    # ------------------------------------------------------------------
    # API state — exact same shape as data.js buildInitialState()
    # ------------------------------------------------------------------
    def get_api_state(self):
        with self._lock:
            devices = [
                {
                    "deviceId":     d["device_id"],
                    "name":         d["name"],
                    "location":     d["location"],
                    "type":         d["type"],
                    "sector":       d["sector"],
                    "voltage":      d["voltage"],
                    "current":      d["current"],
                    "power":        d["power"],
                    "temperature":  d["temperature"],
                    "status":       d["status"],
                    # Not measured by the C++ simulator — reported as 0.
                    # The dashboard calls .toFixed(2) on this value, so it
                    # must stay numeric. See backend/README.md.
                    "frequency":    0,
                    "_lastUpdate":  d["last_seen_ms"],
                }
                for d in self.db.get_devices()
            ]

            anomalies = [
                {
                    "id":          a["id"],
                    "deviceId":    a["device_id"],
                    "type":        a["type"],
                    "severity":    a["severity"],
                    "description": a["description"],
                    "confidence":  a["confidence"],
                    "status":      a["status"],
                    "timestamp":   a["detected_ms"],
                }
                for a in self.db.get_anomalies(config.EVENT_LIST_LIMIT)
            ]

            intrusions = [
                {
                    "id":        e["id"],
                    "deviceId":  e["device_id"],
                    "type":      e["type"],
                    "severity":  e["severity"],
                    "sourceIp":  e["source_ip"],
                    "action":    e["action"],
                    "timestamp": e["timestamp_ms"],
                }
                for e in self.db.get_intrusions(config.EVENT_LIST_LIMIT)
            ]

            alerts = [
                {
                    "severity":    a["severity"],
                    "deviceId":    a["device_id"],
                    "type":        a["type"],
                    "description": a["description"],
                    "timestamp":   a["timestamp_ms"],
                    "status":      a["status"],
                }
                for a in self.db.get_alerts(30)
            ]

            activity = [
                {
                    "icon":      a["icon"],
                    "title":     a["title"],
                    "detail":    a["detail"],
                    "timestamp": a["timestamp_ms"],
                }
                for a in self.db.get_activity(30)
            ]

            points = self.db.get_chart_points(config.CHART_MAX_POINTS)
            chart_history = {
                "labels":           [p["label"] for p in points],
                "powerConsumption": [p["power_consumption"] for p in points],
                # Generation is not metered separately → null (rendered
                # as a gap by Chart.js). See backend/README.md.
                "powerGeneration":  [p["power_generation"] for p in points],
                "voltage":          [p["voltage"] for p in points],
                "current":          [p["current"] for p in points],
                "tempA":            [p["temp_a"] for p in points],
                "tempB":            [p["temp_b"] for p in points],
            }

            counters = self.db.get_counters()
            settings = self.db.get_settings()

        return {
            "devices":      devices,
            "anomalies":    anomalies,
            "intrusions":   intrusions,
            "alerts":       alerts,
            "activity":     activity,
            "chartHistory": chart_history,
            "counters":     counters,
            "settings":     settings,
            "lastUpdated":  now_ms(),
            "liveMode":     True,
        }

    # ------------------------------------------------------------------
    # Mutations requested through the REST API
    # ------------------------------------------------------------------
    def resolve_anomaly(self, anomaly_id):
        with self._lock:
            self.db.resolve_anomaly(anomaly_id, now_ms())
        self._maybe_notify(force=True)

    def update_settings(self, partial):
        with self._lock:
            result = self.db.update_settings(partial)
        self._maybe_notify(force=True)
        return result

    def reset(self):
        with self._lock:
            self.db.reset_events()
        self._maybe_notify(force=True)
