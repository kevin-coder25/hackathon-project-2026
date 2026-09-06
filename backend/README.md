# GridGuard AI — Backend

MQTT → SQLite → REST/SSE bridge that connects the C++ edge simulator to the
existing frontend dashboard. Everything runs locally; there are no cloud
services and no external APIs.

```
C++ edge simulator          Mosquitto            backend (this folder)
(edge_simulator/)  ──MQTT──▶ localhost:1883 ──▶ bridge.py ──▶ SQLite (gridguard.db)
                                                    │
                                                    ▼
                             frontend (unchanged UI) ◀── REST + SSE (server.py)
```

## Quick start

```bash
./run.sh                # broker + backend + simulator (creates venv on first run)
./run.sh --no-sim       # broker + backend only
```

Then open <http://127.0.0.1:8080/>.

Manual equivalent (if you prefer to run the pieces yourself):

```bash
# 1. broker
mosquitto &                                   # or: /usr/local/sbin/mosquitto &

# 2. backend (creates backend/venv once, then)
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python server.py

# 3. simulator (already built at edge_simulator/build/)
cd ../edge_simulator && ./build/gridguard_simulator data/device_config.json
```

## Files

| File             | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `config.py`      | All configuration; every value overridable via env vars        |
| `db.py`          | Thread-safe SQLite layer (single connection + RLock)           |
| `bridge.py`      | MQTT subscriber, telemetry translation, anomaly episodes, intrusion generator, SSE fan-out |
| `server.py`      | REST + SSE + static file server (Python stdlib `http.server`)  |
| `run.sh`         | One-command launcher for the whole stack                       |
| `requirements.txt` | The only third-party dependency: `paho-mqtt`                 |

## Configuration (environment variables)

| Variable                        | Default               | Meaning                          |
|---------------------------------|-----------------------|----------------------------------|
| `GRIDGUARD_MQTT_HOST`           | `localhost`           | Mosquitto broker address         |
| `GRIDGUARD_MQTT_PORT`           | `1883`                | Mosquitto broker port            |
| `GRIDGUARD_MQTT_TOPIC`          | `gridguard/telemetry` | Telemetry topic                  |
| `GRIDGUARD_MQTT_CLIENT_ID`      | `gridguard-backend-bridge` | MQTT client ID (change it when running a second bridge instance) |
| `GRIDGUARD_HTTP_HOST`           | `127.0.0.1`           | HTTP bind address                |
| `GRIDGUARD_HTTP_PORT`           | `8080`                | HTTP port                        |
| `GRIDGUARD_DB`                  | `backend/gridguard.db`| SQLite database path             |
| `GRIDGUARD_CHART_INTERVAL`      | `5`                   | Seconds between chart samples    |
| `GRIDGUARD_INTRUSION_INTERVAL`  | `30`                  | Seconds between security-event rolls |
| `GRIDGUARD_INTRUSION_PROBABILITY` | `0.12`              | Chance per roll (set `0` to disable) |

## Database schema (SQLite)

| Table          | Contents                                                            |
|----------------|---------------------------------------------------------------------|
| `devices`      | Latest state of every device seen on MQTT (`device_id` PK)          |
| `telemetry`    | Raw telemetry history (indexed by device + timestamp, pruned at 10 000 rows) |
| `anomalies`    | One row per anomaly **episode** (`ANM-XXXX`, active/investigating/resolved) |
| `intrusions`   | Security events (`IDS-XXXX`)                                        |
| `alerts`       | Alert feed entries                                                  |
| `activity`     | Activity-log entries (icon/title/detail)                            |
| `chart_points` | Sampled chart history (5 s cadence, last 48 served)                 |
| `counters`     | `anomalyId`, `intrusionId`, `threatsBlocked`                        |
| `settings`     | `refreshInterval`, `sensitivity`, `confidence`                      |

## API endpoints

| Method | Path                    | Description                                        |
|--------|-------------------------|----------------------------------------------------|
| GET    | `/api/health`           | `{status, mqttConnected, devices, uptimeSeconds}`  |
| GET    | `/api/state`            | Full dashboard state (exact `GridGuardData` shape) |
| GET    | `/api/devices`          | Device list                                        |
| GET    | `/api/anomalies`        | Anomaly list                                       |
| GET    | `/api/intrusions`       | Intrusion list                                     |
| GET    | `/api/settings`         | Settings                                           |
| GET    | `/api/events`           | **SSE** stream: `hello` on connect, `tick` on data changes, heartbeat every 15 s |
| POST   | `/api/settings`         | Body: partial settings → updates and returns them  |
| POST   | `/api/anomalies/resolve`| Body: `{"id": "ANM-0001"}` → resolves the episode  |
| POST   | `/api/reset`            | Clears events/chart history (keeps device registry)|
| GET    | `/*` (static)           | Serves the existing `frontend/` (same origin, no CORS) |

## How live mode works

`frontend/assets/js/data.js` calls `GET /api/state` on load. If the backend
answers, the dashboard switches to **live mode**: the built-in fake simulation
is stopped and can never overwrite real telemetry, state changes arrive via
SSE `tick` events (plus a 5 s safety poll), and `save()/reset()/updateSettings()`
are forwarded to the API. If the backend is unreachable, the frontend falls
back to its original self-contained simulated mode — existing behaviour is
fully preserved.

## Anomaly episodes (no duplicate events)

The simulator flags `anomaly_type` on **every reading** while an anomaly is
active (up to 5 ticks). The bridge collapses each such run into exactly **one**
anomaly record per (device, type) episode, refreshing `last_seen_ms` while it
continues, and auto-resolving it when a clean reading arrives. A repeated
telemetry message therefore never produces a duplicate event.

## Data-fidelity notes & limitations

Nothing is faked to compensate for fields the C++ simulator does not measure.
The following dashboard values are affected in live mode:

1. **Grid frequency — not measured.** The simulator reports voltage, current,
   power and temperature only. The API returns `frequency: 0` for every device
   because the dashboard calls `.toFixed(2)` on it (it must stay numeric), so
   the frequency readout shows `0.00 Hz`. No value is invented.
2. **Power generation — not metered.** All simulator power readings are
   consumption. `chartHistory.powerGeneration` is `null` and the Generation
   line renders as an empty series.
3. **Device names.** The simulator transmits machine IDs only; display names
   use the device *type* from `edge_simulator/data/device_config.json`
   (e.g. `GRID-001` → "Substation").
4. **Only the 5 configured devices exist** (`GRID-001`…`GRID-005`). Live mode
   shows real devices only — it never invents extra ones.
5. **Intrusion/security events are generated by the bridge**, not by the C++
   simulator (which emits no security events). The generator is a faithful
   port of the frontend's original `simulation.js` logic (same event types,
   source IPs, severity distribution) so the Security page keeps its intended
   behaviour. Set `GRIDGUARD_INTRUSION_PROBABILITY=0` to disable it.
6. **Anomaly confidence is a rule-based score** (85–99) derived from how far
   the real reading deviates from the device's configured baseline — not an
   ML model output.
7. **Timestamps.** The simulator formats timestamps with `std::localtime`
   but appends a misleading `Z`. The bridge parses them as local time so the
   dashboard clock matches wall-clock time.
