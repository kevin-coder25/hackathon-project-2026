/* ========================================================================
   GRIDGUARD AI — Chart Manager (charts.js)
   ========================================================================
   Creates and updates all Chart.js instances using live data from the
   GridGuardData layer.  Charts auto-refresh every 5 seconds.

   Chart canvases (IDs used across pages):
     chart-power          — Power consumption + generation (line)
     chart-voltage        — Voltage + current dual-axis (line)
     chart-temperature    — Temperature A + B + threshold (line)
     chart-sector-power   — Sector power consumption (bar)
     chart-anomaly-types  — Anomaly type distribution (doughnut)
   ======================================================================== */

var GridGuardCharts = (function () {

    /* Bail out entirely if Chart.js is not loaded on this page */
    if (typeof Chart === 'undefined') {
        return { init: function(){}, update: function(){}, destroy: function(){} };
    }

    /* ------------------------------------------------------------------
       THEME COLORS (read from CSS custom properties)
       ------------------------------------------------------------------ */
    var rootStyles = getComputedStyle(document.documentElement);

    var colors = {
        cyan:   rootStyles.getPropertyValue('--chart-1').trim() || '#00d4ff',
        teal:   rootStyles.getPropertyValue('--chart-2').trim() || '#14b8a6',
        violet: rootStyles.getPropertyValue('--chart-3').trim() || '#8b5cf6',
        amber:  rootStyles.getPropertyValue('--chart-4').trim() || '#f59e0b',
        red:    rootStyles.getPropertyValue('--chart-5').trim() || '#ef4444',
        green:  rootStyles.getPropertyValue('--chart-6').trim() || '#10b981',
        grid:   rootStyles.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.06)',
        tick:   rootStyles.getPropertyValue('--chart-tick').trim() || '#64748b'
    };

    /* ------------------------------------------------------------------
       SHARED SCALE FACTORY
       ------------------------------------------------------------------ */
    function scaleOpts(min, max, stepSize) {
        return {
            grid: { color: colors.grid, drawBorder: false },
            ticks: {
                color: colors.tick,
                font: { family: "'JetBrains Mono', monospace", size: 11 },
                stepSize: stepSize || undefined
            },
            min: min,
            max: max
        };
    }

    /* ------------------------------------------------------------------
       CHART DEFAULTS
       ------------------------------------------------------------------ */
    Chart.defaults.font.family = "'Inter', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.color = colors.tick;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 12;
    Chart.defaults.plugins.legend.labels.padding = 20;
    Chart.defaults.plugins.tooltip.backgroundColor = '#162038';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(0, 212, 255, 0.25)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.titleFont = { family: "'Inter', sans-serif", size: 12, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { family: "'JetBrains Mono', monospace", size: 12 };

    /* ------------------------------------------------------------------
       INSTANCE STORAGE
       ------------------------------------------------------------------ */
    var instances = {};

    /* ------------------------------------------------------------------
       1. POWER CONSUMPTION CHART
       ------------------------------------------------------------------ */
    function createPowerChart() {
        var canvas = document.getElementById('chart-power');
        if (!canvas) return;

        var history = GridGuardData.getChartHistory();

        instances.power = new Chart(canvas, {
            type: 'line',
            data: {
                labels: history.labels.slice(),
                datasets: [
                    {
                        label: 'Consumption (kW)',
                        data: history.powerConsumption.slice(),
                        borderColor: colors.cyan,
                        backgroundColor: 'rgba(0, 212, 255, 0.08)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: colors.cyan,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Generation (kW)',
                        data: history.powerGeneration.slice(),
                        borderColor: colors.teal,
                        backgroundColor: 'rgba(13, 148, 136, 0.06)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: colors.teal,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: scaleOpts(),
                    y: scaleOpts(2000, 7000, 1000)
                },
                plugins: { legend: { position: 'top', align: 'end' } }
            }
        });
    }

    /* ------------------------------------------------------------------
       2. VOLTAGE & CURRENT CHART
       ------------------------------------------------------------------ */
    function createVoltageChart() {
        var canvas = document.getElementById('chart-voltage');
        if (!canvas) return;

        var history = GridGuardData.getChartHistory();

        instances.voltage = new Chart(canvas, {
            type: 'line',
            data: {
                labels: history.labels.slice(),
                datasets: [
                    {
                        label: 'Voltage (V)',
                        data: history.voltage.slice(),
                        borderColor: colors.cyan,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0.3,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Current (A)',
                        data: history.current.slice(),
                        borderColor: colors.amber,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0.3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: scaleOpts(),
                    y: Object.assign(scaleOpts(220, 240, 5), {
                        position: 'left',
                        title: { display: true, text: 'Voltage (V)', color: colors.tick, font: { size: 11 } }
                    }),
                    y1: Object.assign(scaleOpts(10, 30, 5), {
                        position: 'right',
                        title: { display: true, text: 'Current (A)', color: colors.tick, font: { size: 11 } },
                        grid: { drawOnChartArea: false }
                    })
                },
                plugins: { legend: { position: 'top', align: 'end' } }
            }
        });
    }

    /* ------------------------------------------------------------------
       3. TEMPERATURE CHART
       ------------------------------------------------------------------ */
    function createTemperatureChart() {
        var canvas = document.getElementById('chart-temperature');
        if (!canvas) return;

        var history = GridGuardData.getChartHistory();
        var thresholdLine = new Array(history.labels.length).fill(75);

        instances.temperature = new Chart(canvas, {
            type: 'line',
            data: {
                labels: history.labels.slice(),
                datasets: [
                    {
                        label: 'Transformer A (\u00b0C)',
                        data: history.tempA.slice(),
                        borderColor: colors.cyan,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0.3
                    },
                    {
                        label: 'Transformer B (\u00b0C)',
                        data: history.tempB.slice(),
                        borderColor: colors.violet,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0.3
                    },
                    {
                        label: 'Threshold',
                        data: thresholdLine,
                        borderColor: colors.red,
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: scaleOpts(),
                    y: scaleOpts(30, 85, 10)
                },
                plugins: { legend: { position: 'top', align: 'end' } }
            }
        });
    }

    /* ------------------------------------------------------------------
       4. SECTOR POWER CHART (Analytics page — bar)
       ------------------------------------------------------------------ */
    function createSectorPowerChart() {
        var canvas = document.getElementById('chart-sector-power');
        if (!canvas) return;

        var devices = GridGuardData.getMainDevices();
        var labels  = devices.map(function(d) { return d.sector; });
        var data    = devices.map(function(d) { return d.power; });

        instances.sectorPower = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Consumption (kW)',
                    data: data,
                    backgroundColor: 'rgba(0, 212, 255, 0.35)',
                    hoverBackgroundColor: 'rgba(0, 212, 255, 0.60)',
                    borderColor: colors.cyan,
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: scaleOpts(),
                    y: scaleOpts(0, 7000, 1000)
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    /* ------------------------------------------------------------------
       5. ANOMALY DISTRIBUTION CHART (Analytics page — doughnut)
       ------------------------------------------------------------------ */
    function createAnomalyTypesChart() {
        var canvas = document.getElementById('chart-anomaly-types');
        if (!canvas) return;

        /* Count anomaly types from data */
        var anomalies = GridGuardData.getAnomalies();
        var typeCounts = {};
        GridGuardData.ANOMALY_TYPES.forEach(function(t) { typeCounts[t] = 0; });
        typeCounts['Other'] = 0;
        anomalies.forEach(function(a) {
            if (typeCounts.hasOwnProperty(a.type)) typeCounts[a.type]++;
            else typeCounts['Other']++;
        });

        var labels = Object.keys(typeCounts);
        var data   = labels.map(function(l) { return typeCounts[l]; });

        instances.anomalyTypes = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        'rgba(0, 212, 255, 0.75)',
                        'rgba(20, 184, 166, 0.75)',
                        'rgba(139, 92, 246, 0.75)',
                        'rgba(245, 158, 11, 0.75)',
                        'rgba(239, 68, 68, 0.75)',
                        'rgba(100, 116, 139, 0.75)',
                        'rgba(99, 102, 241, 0.75)',
                        'rgba(236, 72, 153, 0.75)'
                    ],
                    borderColor: '#111a30',
                    borderWidth: 3,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, padding: 16 } }
                }
            }
        });
    }

    /* ------------------------------------------------------------------
       UPDATE ALL CHARTS FROM LATEST DATA
       ------------------------------------------------------------------ */
    function updateAll() {
        var history = GridGuardData.getChartHistory();

        /* Power chart */
        if (instances.power) {
            instances.power.data.labels = history.labels.slice();
            instances.power.data.datasets[0].data = history.powerConsumption.slice();
            instances.power.data.datasets[1].data = history.powerGeneration.slice();
            instances.power.update('none');
        }

        /* Voltage chart */
        if (instances.voltage) {
            instances.voltage.data.labels = history.labels.slice();
            instances.voltage.data.datasets[0].data = history.voltage.slice();
            instances.voltage.data.datasets[1].data = history.current.slice();
            instances.voltage.update('none');
        }

        /* Temperature chart */
        if (instances.temperature) {
            instances.temperature.data.labels = history.labels.slice();
            instances.temperature.data.datasets[0].data = history.tempA.slice();
            instances.temperature.data.datasets[1].data = history.tempB.slice();
            instances.temperature.data.datasets[2].data = new Array(history.labels.length).fill(75);
            instances.temperature.update('none');
        }

        /* Sector power (analytics) */
        if (instances.sectorPower) {
            var devices = GridGuardData.getMainDevices();
            instances.sectorPower.data.labels = devices.map(function(d) { return d.sector; });
            instances.sectorPower.data.datasets[0].data = devices.map(function(d) { return d.power; });
            instances.sectorPower.update('none');
        }

        /* Anomaly types (analytics) */
        if (instances.anomalyTypes) {
            var anomalies = GridGuardData.getAnomalies();
            var typeCounts = {};
            GridGuardData.ANOMALY_TYPES.forEach(function(t) { typeCounts[t] = 0; });
            typeCounts['Other'] = 0;
            anomalies.forEach(function(a) {
                if (typeCounts.hasOwnProperty(a.type)) typeCounts[a.type]++;
                else typeCounts['Other']++;
            });
            instances.anomalyTypes.data.labels = Object.keys(typeCounts);
            instances.anomalyTypes.data.datasets[0].data = Object.keys(typeCounts).map(function(l) { return typeCounts[l]; });
            instances.anomalyTypes.update('none');
        }
    }

    /* ------------------------------------------------------------------
       INIT — create all charts that have a canvas on this page
       ------------------------------------------------------------------ */
    function init() {
        createPowerChart();
        createVoltageChart();
        createTemperatureChart();
        createSectorPowerChart();
        createAnomalyTypesChart();
    }

    /* ------------------------------------------------------------------
       DESTROY ALL
       ------------------------------------------------------------------ */
    function destroy() {
        for (var key in instances) {
            if (instances[key]) instances[key].destroy();
        }
        instances = {};
    }

    /* ------------------------------------------------------------------
       PUBLIC API
       ------------------------------------------------------------------ */
    return {
        init:    init,
        update:  updateAll,
        destroy: destroy,
        instances: instances
    };

})();
