/* ========================================================================
   GRIDGUARD AI — Device.h
   ========================================================================
   Represents a single smart-grid edge device that continuously produces
   sensor readings.  Values drift gradually to simulate real hardware.
   ======================================================================== */

#ifndef GRIDGUARD_DEVICE_H
#define GRIDGUARD_DEVICE_H

#include "SensorData.h"
#include <string>
#include <random>

namespace gridguard {

/* Configuration for a single device (loaded from JSON) */
struct DeviceConfig {
    std::string deviceId;          /* "GRID-001"                        */
    std::string location;          /* "Sector A-1"                      */
    std::string type;              /* "Substation", "Solar Inverter" …  */
    double      baseVoltage;       /* Nominal voltage (V)               */
    double      baseCurrent;       /* Nominal current (A)               */
    double      baseTemperature;   /* Nominal temperature (°C)          */
};

class Device {
public:
    explicit Device(const DeviceConfig& config);

    /* Generate one sensor reading with current state */
    SensorData generateReading();

    /* Drift metrics gradually (call each tick) */
    void drift();

    /* Apply a named anomaly to the device state */
    void applyAnomaly(const std::string& anomalyType);

    /* Clear any active anomaly, return to normal */
    void clearAnomaly();

    /* Force device offline (and back) */
    void setOffline(bool offline);

    /* Accessors */
    const std::string& getId() const       { return m_config.deviceId; }
    const std::string& getLocation() const { return m_config.location; }
    const std::string& getStatus() const   { return m_status; }

private:
    DeviceConfig m_config;

    /* Current live values */
    double      m_voltage;
    double      m_current;
    double      m_temperature;
    std::string m_status;         /* "online", "offline", "maintenance" */

    /* Anomaly state */
    bool        m_hasAnomaly;
    std::string m_activeAnomalyType;
    Severity    m_activeSeverity;

    /* Random-number engine (one per device for independence) */
    std::mt19937 m_rng;

    /* Helper: clamp value between min and max */
    static double clamp(double val, double lo, double hi);

    /* Helper: generate ISO-8601 timestamp */
    static std::string currentTimestamp();
};

} /* namespace gridguard */

#endif /* GRIDGUARD_DEVICE_H */
