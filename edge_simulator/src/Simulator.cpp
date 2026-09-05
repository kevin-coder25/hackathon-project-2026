#include "Simulator.h"

#include <iostream>
#include <thread>
#include <chrono>
#include <iomanip>
#include <sstream>

#include <mqtt/connect_options.h>

namespace gridguard {

namespace {
    const std::string MQTT_BROKER = "tcp://localhost:1883";
    const std::string MQTT_TOPIC  = "gridguard/telemetry";
}

Simulator::Simulator(const SimulatorConfig& config)
    : m_anomalyGen(config.anomaly)
    , m_intervalSec(config.updateIntervalSeconds)
    , m_running(true)
{
    for (const auto& dc : config.devices) {
        m_devices.emplace_back(dc);
    }

    m_mqttClient = std::make_unique<mqtt::async_client>(
        MQTT_BROKER,
        "gridguard-edge-simulator"
    );

    try {
        auto connOpts = mqtt::connect_options_builder()
            .clean_session(true)
            .keep_alive_interval(std::chrono::seconds(20))
            .finalize();

        m_mqttClient->connect(connOpts)->wait();

        std::cout << "  MQTT Broker : " << MQTT_BROKER << "\n";
        std::cout << "  MQTT Topic  : " << MQTT_TOPIC << "\n";
        std::cout << "  MQTT Status : connected\n";

    } catch (const mqtt::exception& e) {
        std::cerr << "  MQTT connection failed: " << e.what() << "\n";
        std::cerr << "  Simulator will continue without MQTT.\n";
    }
}

void Simulator::stop()
{
    m_running.store(false);
}

void Simulator::printSeparator()
{
    std::cout << std::string(90, '-') << "\n";
}

void Simulator::run()
{
    std::cout << "\n";
    std::cout << "  ╔══════════════════════════════════════════════════════════╗\n";
    std::cout << "  ║           GRIDGUARD AI — Edge Device Simulator         ║\n";
    std::cout << "  ╚══════════════════════════════════════════════════════════╝\n";
    std::cout << "\n";
    std::cout << "  Devices     : " << m_devices.size() << "\n";
    std::cout << "  Interval    : " << m_intervalSec << " s\n";
    std::cout << "  Anomaly prob: ~"
              << std::fixed << std::setprecision(1)
              << (m_anomalyGen.getConfig().voltageSpikeProbability +
                  m_anomalyGen.getConfig().voltageDropProbability +
                  m_anomalyGen.getConfig().highCurrentProbability +
                  m_anomalyGen.getConfig().excessivePowerProbability +
                  m_anomalyGen.getConfig().highTemperatureProbability +
                  m_anomalyGen.getConfig().deviceOfflineProbability) * 100.0
              << "% per tick (combined)\n";
    std::cout << "  Press Ctrl+C to stop.\n";
    std::cout << "\n";

    int tickCount = 0;

    while (m_running.load()) {
        ++tickCount;

        for (auto& dev : m_devices) {
            dev.drift();
        }

        auto anomalyOpt = m_anomalyGen.roll();
        int anomalyDeviceIdx = -1;

        if (anomalyOpt.has_value()) {
            std::uniform_int_distribution<int> deviceDist(
                0,
                static_cast<int>(m_devices.size()) - 1
            );

            std::mt19937 pickRng(
                static_cast<unsigned>(
                    std::chrono::steady_clock::now()
                        .time_since_epoch()
                        .count()
                )
            );

            anomalyDeviceIdx = deviceDist(pickRng);

            if (m_devices[anomalyDeviceIdx].getStatus() != "offline") {
                m_devices[anomalyDeviceIdx].applyAnomaly(
                    anomalyOpt.value()
                );
            } else {
                anomalyDeviceIdx = -1;
            }
        }

        printSeparator();
        std::cout << "  TICK #" << tickCount << "\n";
        printSeparator();

        for (size_t i = 0; i < m_devices.size(); ++i) {
            SensorData reading = m_devices[i].generateReading();

            std::cout << "  " << reading.toReadableString() << "\n";
            std::cout << "  JSON: " << reading.toJson() << "\n";

            if (m_mqttClient && m_mqttClient->is_connected()) {
                try {
                    auto message = mqtt::make_message(
                        MQTT_TOPIC,
                        reading.toJson()
                    );

                    message->set_qos(0);
                    message->set_retained(false);

                    m_mqttClient->publish(message);

                } catch (const mqtt::exception& e) {
                    std::cerr << "  MQTT publish failed: "
                              << e.what() << "\n";
                }
            }
        }

        if (anomalyDeviceIdx >= 0 && tickCount % 3 == 0) {
            /* Anomaly persists for a few ticks, then resolves */
        }

        if (tickCount % 5 == 0) {
            for (auto& dev : m_devices) {
                dev.clearAnomaly();
            }
        }

        std::cout << "\n";

        for (int s = 0; s < m_intervalSec && m_running.load(); ++s) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
    }

    if (m_mqttClient && m_mqttClient->is_connected()) {
        try {
            m_mqttClient->disconnect()->wait();
        } catch (const mqtt::exception& e) {
            std::cerr << "  MQTT disconnect failed: "
                      << e.what() << "\n";
        }
    }

    std::cout << "\n  Simulator stopped after "
              << tickCount << " ticks.\n\n";
}

}
