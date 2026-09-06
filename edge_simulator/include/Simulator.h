#ifndef GRIDGUARD_SIMULATOR_H
#define GRIDGUARD_SIMULATOR_H

#include "Device.h"
#include "AnomalyGenerator.h"

#include <vector>
#include <atomic>
#include <string>
#include <memory>

#include <mqtt/async_client.h>

namespace gridguard {

struct SimulatorConfig {
    std::vector<DeviceConfig> devices;
    AnomalyConfig             anomaly;
    int                       updateIntervalSeconds = 2;
};

class Simulator {
public:
    explicit Simulator(const SimulatorConfig& config);
    void run();
    void stop();
    const std::vector<Device>& devices() const { return m_devices; }

private:
    std::vector<Device>    m_devices;
    AnomalyGenerator       m_anomalyGen;
    int                    m_intervalSec;
    std::atomic<bool>      m_running;

    std::unique_ptr<mqtt::async_client> m_mqttClient;

    static void printSeparator();
};

}

#endif
