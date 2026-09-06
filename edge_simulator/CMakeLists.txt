cmake_minimum_required(VERSION 3.14)

project(gridguard_simulator
    VERSION 1.0.0
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(SOURCES
    src/main.cpp
    src/Device.cpp
    src/Simulator.cpp
    src/AnomalyGenerator.cpp
)

add_executable(gridguard_simulator ${SOURCES})

target_include_directories(gridguard_simulator
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

find_package(PahoMqttCpp REQUIRED)
find_package(Threads REQUIRED)

target_link_libraries(gridguard_simulator
    PRIVATE
        PahoMqttCpp::paho-mqttpp3
        Threads::Threads
)

if(MSVC)
    target_compile_options(gridguard_simulator PRIVATE /W4)
else()
    target_compile_options(gridguard_simulator PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )
endif()
