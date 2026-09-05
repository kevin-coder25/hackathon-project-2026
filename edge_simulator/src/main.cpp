/* ========================================================================
   GRIDGUARD AI — main.cpp
   ========================================================================
   Entry point for the edge device simulator.

   • Reads configuration from  data/device_config.json  (relative to CWD)
   • Falls back to built-in defaults if the file cannot be read
   • Installs a SIGINT handler so Ctrl+C stops gracefully
   • Starts the Simulator main loop
   ======================================================================== */

#include "Simulator.h"

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <csignal>
#include <memory>

/* ------------------------------------------------------------------
   Minimal JSON parser — just enough for device_config.json.
   Avoids pulling in a third-party JSON library so the project
   compiles with zero external dependencies.
   ------------------------------------------------------------------ */

/* Trim whitespace from both ends */
static std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\n\r");
    return s.substr(start, end - start + 1);
}

/* Extract the value part of "key": value (handles strings and numbers) */
static std::string extractValue(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\"";
    auto pos = json.find(searchKey);
    if (pos == std::string::npos) return "";

    pos = json.find(':', pos + searchKey.size());
    if (pos == std::string::npos) return "";

    /* Skip whitespace after colon */
    pos = json.find_first_not_of(" \t\n\r", pos + 1);
    if (pos == std::string::npos) return "";

    if (json[pos] == '"') {
        /* String value */
        auto end = json.find('"', pos + 1);
        if (end == std::string::npos) return "";
        return json.substr(pos + 1, end - pos - 1);
    } else {
        /* Number or literal */
        auto end = json.find_first_of(",}\n\r", pos);
        if (end == std::string::npos) end = json.size();
        return trim(json.substr(pos, end - pos));
    }
}

/* Split a JSON array of objects (very basic — assumes each object on
   its own line group, delimited by { … }) */
static std::vector<std::string> splitDeviceObjects(const std::string& arrayStr) {
    std::vector<std::string> objects;
    int depth = 0;
    std::string current;

    for (char c : arrayStr) {
        if (c == '{') {
            if (depth == 0) current.clear();
            depth++;
            current += c;
        } else if (c == '}') {
            current += c;
            depth--;
            if (depth == 0) {
                objects.push_back(current);
            }
        } else if (depth > 0) {
            current += c;
        }
    }
    return objects;
}

/* ------------------------------------------------------------------
   Build default config (matches data/device_config.json)
   ------------------------------------------------------------------ */
static gridguard::SimulatorConfig buildDefaultConfig() {
    gridguard::SimulatorConfig cfg;
    cfg.updateIntervalSeconds = 2;

    cfg.devices = {
        { "GRID-001", "Sector A-1", "Substation",      230.0, 18.5, 54.0 },
        { "GRID-002", "Sector A-2", "Distribution",    230.0, 16.0, 48.0 },
        { "GRID-003", "Sector B-3", "Solar Inverter",  231.0, 21.0, 61.0 },
        { "GRID-004", "Sector B-7", "Wind Converter",  229.0, 14.5, 45.0 },
        { "GRID-005", "Sector C-4", "Transformer",     230.0, 19.0, 58.0 }
    };

    cfg.anomaly = {
        0.02,   /* voltage spike   */
        0.02,   /* voltage drop    */
        0.015,  /* high current    */
        0.01,   /* excessive power */
        0.015,  /* high temperature*/
        0.005   /* device offline  */
    };

    return cfg;
}

/* ------------------------------------------------------------------
   Attempt to load config from JSON file
   ------------------------------------------------------------------ */
static gridguard::SimulatorConfig loadConfig(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "  [config] Could not open " << path
                  << " — using built-in defaults.\n";
        return buildDefaultConfig();
    }

    std::ostringstream ss;
    ss << file.rdbuf();
    std::string json = ss.str();

    gridguard::SimulatorConfig cfg;

    /* Parse interval */
    std::string intervalStr = extractValue(json, "update_interval_seconds");
    cfg.updateIntervalSeconds = intervalStr.empty() ? 2 : std::stoi(intervalStr);

    /* Parse anomaly probabilities */
    cfg.anomaly.voltageSpikeProbability    = std::stod(extractValue(json, "voltage_spike_probability").empty()    ? "0.02"  : extractValue(json, "voltage_spike_probability"));
    cfg.anomaly.voltageDropProbability     = std::stod(extractValue(json, "voltage_drop_probability").empty()     ? "0.02"  : extractValue(json, "voltage_drop_probability"));
    cfg.anomaly.highCurrentProbability     = std::stod(extractValue(json, "high_current_probability").empty()     ? "0.015" : extractValue(json, "high_current_probability"));
    cfg.anomaly.excessivePowerProbability  = std::stod(extractValue(json, "excessive_power_probability").empty()  ? "0.01"  : extractValue(json, "excessive_power_probability"));
    cfg.anomaly.highTemperatureProbability = std::stod(extractValue(json, "high_temperature_probability").empty() ? "0.015" : extractValue(json, "high_temperature_probability"));
    cfg.anomaly.deviceOfflineProbability   = std::stod(extractValue(json, "device_offline_probability").empty()   ? "0.005" : extractValue(json, "device_offline_probability"));

    /* Parse devices array */
    auto devStart = json.find("\"devices\"");
    if (devStart == std::string::npos) {
        std::cerr << "  [config] No 'devices' array found — using defaults.\n";
        return buildDefaultConfig();
    }

    auto arrStart = json.find('[', devStart);
    auto arrEnd   = json.rfind(']');
    if (arrStart == std::string::npos || arrEnd == std::string::npos) {
        return buildDefaultConfig();
    }

    std::string arrayStr = json.substr(arrStart, arrEnd - arrStart + 1);
    auto deviceObjects = splitDeviceObjects(arrayStr);

    for (const auto& obj : deviceObjects) {
        gridguard::DeviceConfig dc;
        dc.deviceId        = extractValue(obj, "device_id");
        dc.location        = extractValue(obj, "location");
        dc.type            = extractValue(obj, "type");

        std::string bv = extractValue(obj, "base_voltage");
        std::string bc = extractValue(obj, "base_current");
        std::string bt = extractValue(obj, "base_temperature");

        dc.baseVoltage      = bv.empty() ? 230.0 : std::stod(bv);
        dc.baseCurrent      = bc.empty() ? 18.0  : std::stod(bc);
        dc.baseTemperature  = bt.empty() ? 55.0  : std::stod(bt);

        if (!dc.deviceId.empty()) {
            cfg.devices.push_back(dc);
        }
    }

    if (cfg.devices.empty()) {
        std::cerr << "  [config] No devices parsed — using defaults.\n";
        return buildDefaultConfig();
    }

    std::cout << "  [config] Loaded " << cfg.devices.size()
              << " devices from " << path << "\n";
    return cfg;
}

/* ------------------------------------------------------------------
   Signal handling — graceful Ctrl+C
   ------------------------------------------------------------------ */
static std::unique_ptr<gridguard::Simulator> g_simulator;

static void signalHandler(int /*signum*/) {
    if (g_simulator) {
        g_simulator->stop();
    }
}

/* ------------------------------------------------------------------
   MAIN
   ------------------------------------------------------------------ */
int main(int argc, char* argv[]) {
    /* Determine config path — default is relative to CWD */
    std::string configPath = "data/device_config.json";
    if (argc > 1) {
        configPath = argv[1];
    }

    /* Load configuration */
    auto cfg = loadConfig(configPath);

    /* Create simulator */
    g_simulator = std::make_unique<gridguard::Simulator>(cfg);

    /* Install signal handler for graceful shutdown */
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    /* Run (blocks until Ctrl+C) */
    g_simulator->run();

    g_simulator.reset();
    return 0;
}
