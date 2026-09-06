# GridGuard AI — Edge Device Simulator

C++17 simulator that emulates 5 smart-grid edge devices producing realistic
telemetry (voltage, current, power, temperature, status) every 2 seconds.

## Quick Start

```bash
# 1. Create a build directory
cd edge_simulator
mkdir build && cd build

# 2. Configure and build
cmake ..
cmake --build .

# 3. Run (Ctrl+C to stop)
./gridguard_simulator
```

The simulator reads `data/device_config.json` for device definitions and
anomaly probabilities.  If the file is not found, built-in defaults are used.

You can also pass a custom config path:

```bash
./gridguard_simulator ../data/device_config.json
```

## Simulated Devices

| ID       | Location   | Type            |
|----------|------------|-----------------|
| GRID-001 | Sector A-1 | Substation      |
| GRID-002 | Sector A-2 | Distribution    |
| GRID-003 | Sector B-3 | Solar Inverter  |
| GRID-004 | Sector B-7 | Wind Converter  |
| GRID-005 | Sector C-4 | Transformer     |

## Output

Each tick produces human-readable lines **and** JSON:

```
[2026-09-04T12:00:02.123Z]  GRID-001  V=230.12 V  I=18.47 A  P=4250.32 W  T=54.12 °C  status=online
JSON: {"device_id":"GRID-001","location":"Sector A-1","voltage":230.12,...}
```

## Anomaly Types

| Type              | Severity | Effect                                |
|-------------------|----------|---------------------------------------|
| voltage_spike     | CRITICAL | Voltage jumps +12 V above nominal     |
| voltage_drop      | WARNING  | Voltage drops -12 V below nominal     |
| high_current      | WARNING  | Current jumps +8 A above nominal      |
| excessive_power   | CRITICAL | Both V and I increase                 |
| high_temperature  | WARNING  | Temperature jumps +20 °C              |
| device_offline    | CRITICAL | Device goes offline (V/I/T → 0)       |

Probabilities are configurable in `data/device_config.json`.

## Architecture

```
include/
├── SensorData.h         Telemetry reading struct + JSON serialisation
├── Device.h             Single device: drift, anomaly, reading generation
├── AnomalyGenerator.h   Probabilistic anomaly trigger
└── Simulator.h          Main loop orchestrator

src/
├── main.cpp             Entry point, config loader, signal handler
├── Device.cpp           Device implementation
├── Simulator.cpp        Simulator implementation
└── AnomalyGenerator.cpp Anomaly generator implementation
```

## Future: MQTT Integration

The `SensorData::toJson()` method produces valid JSON ready for MQTT
publishing.  When Eclipse Paho is added, only `Simulator::run()` needs
a publish call after each reading — no other files need to change.

## Requirements

- CMake ≥ 3.14
- C++17 compiler (GCC ≥ 7, Clang ≥ 5, MSVC ≥ 19.14)
- No external libraries (zero dependencies)
