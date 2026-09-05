/* ========================================================================
   GRIDGUARD AI — AnomalyGenerator.h
   ========================================================================
   Probabilistic anomaly trigger.  Each tick, it rolls dice for every
   anomaly type and returns the first one that fires (or nothing).
   Probabilities are loaded from configuration.
   ======================================================================== */

#ifndef GRIDGUARD_ANOMALYGENERATOR_H
#define GRIDGUARD_ANOMALYGENERATOR_H

#include <string>
#include <optional>
#include <random>

namespace gridguard {

/* Probability of each anomaly type per tick (0.0 – 1.0) */
struct AnomalyConfig {
    double voltageSpikeProbability   = 0.02;   /* 2% per tick */
    double voltageDropProbability    = 0.02;
    double highCurrentProbability    = 0.015;
    double excessivePowerProbability = 0.01;
    double highTemperatureProbability= 0.015;
    double deviceOfflineProbability  = 0.005;
};

class AnomalyGenerator {
public:
    explicit AnomalyGenerator(const AnomalyConfig& config);

    /* Roll the dice.  Returns anomaly type name, or std::nullopt. */
    std::optional<std::string> roll();

    /* Update config at runtime */
    void setConfig(const AnomalyConfig& config);
    const AnomalyConfig& getConfig() const { return m_config; }

private:
    AnomalyConfig m_config;
    std::mt19937  m_rng;
};

} /* namespace gridguard */

#endif /* GRIDGUARD_ANOMALYGENERATOR_H */
