/* ========================================================================
   GRIDGUARD AI — Device.cpp
   ======================================================================== */

#include "Device.h"

#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <cmath>

namespace gridguard {

/* ------------------------------------------------------------------ */
Device::Device(const DeviceConfig& config)
    : m_config(config)
    , m_voltage(config.baseVoltage)
    , m_current(config.baseCurrent)
    , m_temperature(config.baseTemperature)
    , m_status("online")
    , m_hasAnomaly(false)
    , m_activeAnomalyType("")
    , m_activeSeverity(Severity::NORMAL)
{
    /* Per-device RNG seed for independence */
    auto seed = static_cast<unsigned>(
        std::chrono::steady_clock::now().time_since_epoch().count()
        + std::hash<std::string>{}(config.deviceId)
    );
    m_rng.seed(seed);
}

/* ------------------------------------------------------------------ */
void Device::drift()
{
    if (m_status == "offline") return;   /* offline devices don't drift */

    std::normal_distribution<double> voltageDrift(0.0, 0.25);
    std::normal_distribution<double> currentDrift(0.0, 0.15);
    std::normal_distribution<double> tempDrift(0.0, 0.30);

    m_voltage     = clamp(m_voltage     + voltageDrift(m_rng),
                          m_config.baseVoltage - 6.0,
                          m_config.baseVoltage + 6.0);

    m_current     = clamp(m_current     + currentDrift(m_rng),
                          m_config.baseCurrent - 4.0,
                          m_config.baseCurrent + 4.0);

    m_temperature = clamp(m_temperature + tempDrift(m_rng),
                          m_config.baseTemperature - 10.0,
                          m_config.baseTemperature + 15.0);

    /* If anomaly was cleared, gently return toward baseline */
    if (!m_hasAnomaly) {
        m_voltage     = m_voltage     * 0.95 + m_config.baseVoltage     * 0.05;
        m_current     = m_current     * 0.95 + m_config.baseCurrent     * 0.05;
        m_temperature = m_temperature * 0.95 + m_config.baseTemperature * 0.05;
    }
}

/* ------------------------------------------------------------------ */
SensorData Device::generateReading()
{
    SensorData reading;
    reading.deviceId    = m_config.deviceId;
    reading.location    = m_config.location;
    reading.voltage     = std::round(m_voltage * 100.0) / 100.0;
    reading.current     = std::round(m_current * 100.0) / 100.0;
    reading.power       = std::round(reading.voltage * reading.current * 100.0) / 100.0;
    reading.temperature = std::round(m_temperature * 100.0) / 100.0;
    reading.status      = m_status;
    reading.timestamp   = currentTimestamp();
    reading.severity    = m_activeSeverity;
    reading.anomalyType = m_activeAnomalyType;

    return reading;
}

/* ------------------------------------------------------------------ */
void Device::applyAnomaly(const std::string& anomalyType)
{
    m_hasAnomaly       = true;
    m_activeAnomalyType = anomalyType;

    if (anomalyType == "voltage_spike") {
        m_voltage        = m_config.baseVoltage + 12.0 + std::abs(std::normal_distribution<double>(0, 3)(m_rng));
        m_activeSeverity = Severity::CRITICAL;
    }
    else if (anomalyType == "voltage_drop") {
        m_voltage        = m_config.baseVoltage - 12.0 - std::abs(std::normal_distribution<double>(0, 2)(m_rng));
        m_activeSeverity = Severity::WARNING;
    }
    else if (anomalyType == "high_current") {
        m_current        = m_config.baseCurrent + 8.0 + std::abs(std::normal_distribution<double>(0, 2)(m_rng));
        m_activeSeverity = Severity::WARNING;
    }
    else if (anomalyType == "excessive_power") {
        /* Excessive power is a consequence of high V and I */
        m_voltage        = m_config.baseVoltage + 5.0;
        m_current        = m_config.baseCurrent + 6.0;
        m_activeSeverity = Severity::CRITICAL;
    }
    else if (anomalyType == "high_temperature") {
        m_temperature    = m_config.baseTemperature + 20.0 + std::abs(std::normal_distribution<double>(0, 4)(m_rng));
        m_activeSeverity = Severity::WARNING;
    }
    else if (anomalyType == "device_offline") {
        m_status         = "offline";
        m_voltage        = 0.0;
        m_current        = 0.0;
        m_temperature    = 0.0;
        m_activeSeverity = Severity::CRITICAL;
    }
}

/* ------------------------------------------------------------------ */
void Device::clearAnomaly()
{
    m_hasAnomaly        = false;
    m_activeAnomalyType = "";
    m_activeSeverity    = Severity::NORMAL;

    if (m_status == "offline") {
        m_status = "online";
    }

    /* Snap values back toward baseline */
    m_voltage     = m_config.baseVoltage;
    m_current     = m_config.baseCurrent;
    m_temperature = m_config.baseTemperature;
}

/* ------------------------------------------------------------------ */
void Device::setOffline(bool offline)
{
    if (offline) {
        m_status  = "offline";
        m_voltage = 0.0;
        m_current = 0.0;
    } else {
        m_status  = "online";
        m_voltage = m_config.baseVoltage;
        m_current = m_config.baseCurrent;
    }
}

/* ------------------------------------------------------------------ */
double Device::clamp(double val, double lo, double hi)
{
    return val < lo ? lo : (val > hi ? hi : val);
}

/* ------------------------------------------------------------------ */
std::string Device::currentTimestamp()
{
    auto now  = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    auto ms   = std::chrono::duration_cast<std::chrono::milliseconds>(
                    now.time_since_epoch()) % 1000;

    std::ostringstream oss;
    oss << std::put_time(std::localtime(&time), "%Y-%m-%dT%H:%M:%S");
    oss << '.' << std::setfill('0') << std::setw(3) << ms.count() << "Z";
    return oss.str();
}

/* ------------------------------------------------------------------
   SensorData serialisation helpers
   ------------------------------------------------------------------ */

std::string SensorData::toReadableString() const
{
    std::ostringstream oss;
    oss << "[" << timestamp << "]  "
        << deviceId << "  "
        << "V=" << std::fixed << std::setprecision(2) << voltage << " V  "
        << "I=" << current << " A  "
        << "P=" << power << " W  "
        << "T=" << temperature << " \u00b0C  "
        << "status=" << status;

    if (!anomalyType.empty()) {
        oss << "  ** ANOMALY: " << anomalyType
            << " [" << severityToString(severity) << "] **";
    }

    return oss.str();
}

std::string SensorData::toJson() const
{
    /* Hand-crafted JSON — no external library needed.
       Escape device/location strings just in case.                 */
    std::ostringstream oss;
    oss << "{"
        << "\"device_id\":\""    << deviceId    << "\","
        << "\"location\":\""     << location    << "\","
        << "\"voltage\":"        << std::fixed << std::setprecision(2) << voltage << ","
        << "\"current\":"        << current << ","
        << "\"power\":"          << power   << ","
        << "\"temperature\":"    << temperature << ","
        << "\"status\":\""       << status      << "\","
        << "\"timestamp\":\""    << timestamp   << "\","
        << "\"severity\":\""     << severityToString(severity) << "\","
        << "\"anomaly_type\":\"" << anomalyType << "\""
        << "}";
    return oss.str();
}

} /* namespace gridguard */
