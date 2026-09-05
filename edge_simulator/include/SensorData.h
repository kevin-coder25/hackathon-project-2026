/* ========================================================================
   GRIDGUARD AI — SensorData.h
   ========================================================================
   Plain data structure representing a single telemetry reading from a
   smart-grid device.  Designed to be easily serialised to JSON and
   (later) sent over MQTT.
   ======================================================================== */

#ifndef GRIDGUARD_SENSORDATA_H
#define GRIDGUARD_SENSORDATA_H

#include <string>

namespace gridguard {

/* Severity levels for anomaly classification */
enum class Severity {
    NORMAL,
    WARNING,
    CRITICAL
};

/* Convert severity enum to string */
inline std::string severityToString(Severity s) {
    switch (s) {
        case Severity::NORMAL:   return "NORMAL";
        case Severity::WARNING:  return "WARNING";
        case Severity::CRITICAL: return "CRITICAL";
    }
    return "NORMAL";
}

/* A single telemetry reading from a grid device */
struct SensorData {
    std::string deviceId;       /* e.g. "GRID-001"                         */
    std::string location;       /* e.g. "Sector A-1"                       */
    double      voltage;        /* Volts (V)                               */
    double      current;        /* Amperes (A)                             */
    double      power;          /* Watts (W) — derived from V × I          */
    double      temperature;    /* Celsius (°C)                            */
    std::string status;         /* "online" | "offline" | "maintenance"    */
    std::string timestamp;      /* ISO-8601 formatted timestamp            */
    Severity    severity;       /* NORMAL / WARNING / CRITICAL             */
    std::string anomalyType;    /* Empty string if no anomaly              */

    /* Serialise to a human-readable single-line string */
    std::string toReadableString() const;

    /* Serialise to a valid JSON object string */
    std::string toJson() const;
};

} /* namespace gridguard */

#endif /* GRIDGUARD_SENSORDATA_H */
