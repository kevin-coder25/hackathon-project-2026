# GridGuard AI

Local smart-grid monitoring demo: a C++ edge-device simulator publishes real
telemetry over MQTT, a Python backend bridges it into SQLite and serves a
REST/SSE API, and the existing dashboard renders live data — everything runs
locally with no cloud services.

```
C++ Edge Simulator ──▶ Mosquitto MQTT ──▶ Backend Bridge ──▶ SQLite
 (edge_simulator/)      localhost:1883     (backend/)        gridguard.db
                                                │
                                                ▼
                              REST + SSE API (backend/server.py)
                                                │
                                                ▼
                                   Frontend Dashboard (frontend/)
```

## Run the complete system

```bash
./backend/run.sh
```

That single command starts the Mosquitto broker (if not already running),
the backend (creating `backend/venv` on first run) and the C++ simulator.
Open **http://127.0.0.1:8080/** — the dashboard automatically switches to
live mode and shows real MQTT telemetry. Press Ctrl+C to stop everything.

Useful variants:

```bash
./backend/run.sh --no-sim    # backend + broker only (no simulated telemetry)
```

### Prerequisites (one-time)

| Component      | Install                              | Used for            |
|----------------|--------------------------------------|---------------------|
| Mosquitto      | `brew install mosquitto`             | Local MQTT broker   |
| Paho C/C++     | built from `paho.mqtt.cpp/` → `/usr/local` | Simulator's MQTT client |
| CMake + clang  | Xcode command line tools             | Building the simulator |

The simulator is already built at `edge_simulator/build/gridguard_simulator`;
to rebuild it:

```bash
cd edge_simulator
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

The backend needs Python 3 only — its single third-party dependency
(`paho-mqtt`) is installed into `backend/venv` automatically by `run.sh`.

## Repository layout

| Folder            | Contents                                              |
|-------------------|-------------------------------------------------------|
| `backend/`        | MQTT bridge, SQLite, REST/SSE API — see `backend/README.md` |
| `frontend/`       | Multi-page dashboard (HTML/CSS/vanilla JS, Chart.js already vendored) |
| `edge_simulator/` | C++17 device simulator (5 devices, MQTT publishing)  |
| `paho.mqtt.cpp/`  | Local clone of the Paho MQTT C++ library (build dependency) |

## Documentation

- **`backend/README.md`** — backend architecture, configuration env vars,
  database schema, full API reference, and the data-fidelity notes that list
  exactly which dashboard values the simulator does not measure (frequency,
  power generation) and how they are reported.

## Live mode vs. simulated mode

When the backend is reachable, the dashboard runs in **live mode**: data comes
from `GET /api/state`, updates stream over SSE, and the frontend's built-in
demo simulation is disabled so random data can never overwrite real telemetry.
If the backend is not running, the dashboard transparently falls back to its
original self-contained simulated mode.
