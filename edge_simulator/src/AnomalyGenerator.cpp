/* ========================================================================
   GRIDGUARD AI — AnomalyGenerator.cpp
   ======================================================================== */

#include "AnomalyGenerator.h"
#include <chrono>

namespace gridguard {

AnomalyGenerator::AnomalyGenerator(const AnomalyConfig& config)
    : m_config(config)
{
    /* Seed from high-resolution clock for uniqueness */
    auto seed = static_cast<unsigned>(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    m_rng.seed(seed);
}

std::optional<std::string> AnomalyGenerator::roll()
{
    std::uniform_real_distribution<double> dist(0.0, 1.0);

    /* Evaluate each anomaly type in priority order (critical first).
       Return the first one that fires — at most one anomaly per tick. */

    if (dist(m_rng) < m_config.voltageSpikeProbability)
        return "voltage_spike";

    if (dist(m_rng) < m_config.voltageDropProbability)
        return "voltage_drop";

    if (dist(m_rng) < m_config.highCurrentProbability)
        return "high_current";

    if (dist(m_rng) < m_config.excessivePowerProbability)
        return "excessive_power";

    if (dist(m_rng) < m_config.highTemperatureProbability)
        return "high_temperature";

    if (dist(m_rng) < m_config.deviceOfflineProbability)
        return "device_offline";

    return std::nullopt;
}

void AnomalyGenerator::setConfig(const AnomalyConfig& config)
{
    m_config = config;
}

} /* namespace gridguard */
