/* ========================================================================
   GRIDGUARD AI — Centralized Data Layer (data.js)
   ========================================================================
   Single source of truth for all simulated grid data.
   Uses localStorage so state persists between pages.

   Later this can be replaced with:
       API calls  →  Python backend  →  MQTT  →  SQLite
   without changing any page-level code.
   ======================================================================== */

/* --------------------------------------------------------------------------
   1. NAMESPACE — GridGuardData
   -------------------------------------------------------------------------- */

var GridGuardData = (function () {

    /* ------------------------------------------------------------------
       1a. STORAGE KEY
       ------------------------------------------------------------------ */
    var STORAGE_KEY = 'gridguard_state_v1';

    /* ------------------------------------------------------------------
       1b. DEVICE DEFINITIONS
       ------------------------------------------------------------------ */
    var DEFAULT_DEVICES = [
        { deviceId: 'GRID-001', name: 'Main Substation Alpha',   location: 'Sector A-1', type: 'Substation',      sector: 'A-1', voltage: 230.4, current: 18.5, power: 4263, temperature: 54.2, status: 'online',      frequency: 50.01 },
        { deviceId: 'GRID-002', name: 'Distribution Node Beta',  location: 'Sector A-2', type: 'Distribution',    sector: 'A-2', voltage: 229.8, current: 16.2, power: 3723, temperature: 48.7, status: 'online',      frequency: 50.00 },
        { deviceId: 'GRID-003', name: 'Solar Inverter Array',    location: 'Sector B-3', type: 'Solar Inverter',  sector: 'B-3', voltage: 231.2, current: 21.1, power: 4878, temperature: 61.3, status: 'online',      frequency: 50.02 },
        { deviceId: 'GRID-004', name: 'Wind Turbine Converter',  location: 'Sector B-7', type: 'Wind Converter',  sector: 'B-7', voltage: 228.9, current: 14.8, power: 3388, temperature: 45.1, status: 'maintenance', frequency: 49.98 },
        { deviceId: 'GRID-005', name: 'Transformer Station Delta', location: 'Sector C-4', type: 'Transformer', sector: 'C-4', voltage: 230.1, current: 19.3, power: 4441, temperature: 58.9, status: 'online',      frequency: 50.01 }
    ];

    /* Supplementary devices for the Devices page (realistic registry) */
    var EXTRA_DEVICES = [
        { deviceId: 'MTR-0001',  name: 'Main Intake Meter',         location: 'Sector A-1', type: 'Smart Meter',   sector: 'A-1', voltage: 230.6, current: 18.4, power: 4245, temperature: 52.0, status: 'online',      frequency: 50.01 },
        { deviceId: 'MTR-0003',  name: 'Substation Meter East',     location: 'Sector A-2', type: 'Smart Meter',   sector: 'A-2', voltage: 229.5, current: 16.8, power: 3856, temperature: 49.3, status: 'online',      frequency: 50.00 },
        { deviceId: 'INV-0042',  name: 'Solar Inverter Array 4',    location: 'Sector B-3', type: 'Inverter',      sector: 'B-3', voltage: 231.0, current: 21.3, power: 4921, temperature: 63.5, status: 'online',      frequency: 50.02 },
        { deviceId: 'SNS-0187',  name: 'Transformer Temp Sensor',   location: 'Sector C-4', type: 'Sensor',        sector: 'C-4', voltage: 0,     current: 0,    power: 0,    temperature: 78.4, status: 'maintenance', frequency: 0 },
        { deviceId: 'SNS-0203',  name: 'Grid Sensor North',         location: 'Sector A-2', type: 'Sensor',        sector: 'A-2', voltage: 229.9, current: 0.1,  power: 23,   temperature: 44.2, status: 'online',      frequency: 50.01 },
        { deviceId: 'GW-0015',   name: 'Edge Gateway 15',           location: 'Sector B-7', type: 'Gateway',       sector: 'B-7', voltage: 0,     current: 0,    power: 0,    temperature: 38.1, status: 'online',      frequency: 0 },
        { deviceId: 'FW-0091',   name: 'Firewall Node 91',          location: 'Sector A-1', type: 'Security',      sector: 'A-1', voltage: 0,     current: 0,    power: 0,    temperature: 35.0, status: 'online',      frequency: 0 },
        { deviceId: 'BAT-0012',  name: 'Battery Storage Unit 12',   location: 'Sector C-9', type: 'Storage',       sector: 'C-9', voltage: 0,     current: 0,    power: 0,    temperature: 28.5, status: 'offline',     frequency: 0 },
        { deviceId: 'BKR-0034',  name: 'Circuit Breaker 34',        location: 'Sector B-3', type: 'Breaker',       sector: 'B-3', voltage: 230.8, current: 17.2, power: 3968, temperature: 41.7, status: 'online',      frequency: 50.01 },
        { deviceId: 'SNS-0210',  name: 'Grid Sensor South',         location: 'Sector C-4', type: 'Sensor',        sector: 'C-4', voltage: 0,     current: 0,    power: 0,    temperature: 0,    status: 'offline',     frequency: 0 }
    ];

    /* ------------------------------------------------------------------
       1c. ANOMALY TYPES
       ------------------------------------------------------------------ */
    var ANOMALY_TYPES = [
        'Voltage Spike', 'Voltage Drop', 'High Current',
        'Excessive Power', 'High Temperature', 'Device Offline', 'Unusual Activity'
    ];

    /* ------------------------------------------------------------------
       1d. INTRUSION EVENT TYPES
       ------------------------------------------------------------------ */
    var INTRUSION_TYPES = [
        'Unauthorized Access Attempt', 'Suspicious Traffic',
        'Abnormal Device Activity', 'Authentication Failure', 'Configuration Change'
    ];

    var ATTACK_IPS = [
        '203.0.113.87', '198.51.100.23', '192.0.2.140',
        '198.51.100.77', '203.0.113.29', '192.0.2.88',
        '203.0.113.150', '192.0.2.31', '198.51.100.200'
    ];

    /* ------------------------------------------------------------------
       1e. INITIAL SEED DATA (used on first load)
       ------------------------------------------------------------------ */
    function buildInitialState() {
        var now = Date.now();

        /* Seed anomalies */
        var seedAnomalies = [
            { id: 'ANM-0001', deviceId: 'INV-0042', type: 'Excessive Power',  severity: 'critical', description: 'Unusual power spike — possible grid fault',      confidence: 98.7, status: 'active',       timestamp: now - 3600000 * 1 },
            { id: 'ANM-0002', deviceId: 'FW-0091',  type: 'Unusual Activity',  severity: 'critical', description: 'Unauthorized access attempt blocked',             confidence: 97.1, status: 'blocked',      timestamp: now - 3600000 * 2 },
            { id: 'ANM-0003', deviceId: 'SNS-0187',  type: 'High Temperature',  severity: 'warning',  description: 'Temperature exceeding threshold (78.4 \u00b0C)',    confidence: 94.2, status: 'investigating', timestamp: now - 3600000 * 1.5 },
            { id: 'ANM-0004', deviceId: 'GW-0015',   type: 'Unusual Activity',  severity: 'warning',  description: 'Suspicious traffic pattern on gateway uplink',    confidence: 91.8, status: 'investigating', timestamp: now - 3600000 * 2.5 },
            { id: 'ANM-0005', deviceId: 'GRID-004',  type: 'Voltage Drop',      severity: 'warning',  description: 'Phase imbalance detected on sector B-7',          confidence: 89.5, status: 'investigating', timestamp: now - 3600000 * 3 },
            { id: 'ANM-0006', deviceId: 'MTR-0003',  type: 'Voltage Spike',     severity: 'info',     description: 'Voltage fluctuation within acceptable range',     confidence: 85.3, status: 'resolved',     timestamp: now - 3600000 * 4 },
            { id: 'ANM-0007', deviceId: 'SNS-0203',  type: 'Unusual Activity',  severity: 'info',     description: 'Telemetry gap during firmware update',             confidence: 82.0, status: 'resolved',     timestamp: now - 3600000 * 5 }
        ];

        /* Seed intrusion logs */
        var seedIntrusions = [
            { id: 'IDS-0001', deviceId: 'INV-0042',   type: 'Unauthorized Access Attempt', severity: 'critical', sourceIp: '203.0.113.87',  action: 'Blocked',   timestamp: now - 3600000 * 1 },
            { id: 'IDS-0002', deviceId: 'FW-0091',    type: 'Authentication Failure',      severity: 'critical', sourceIp: '198.51.100.23', action: 'Blocked',   timestamp: now - 3600000 * 2 },
            { id: 'IDS-0003', deviceId: 'GW-0015',    type: 'Suspicious Traffic',          severity: 'warning',  sourceIp: '192.0.2.140',   action: 'Monitored', timestamp: now - 3600000 * 2.8 },
            { id: 'IDS-0004', deviceId: 'MTR-0003',   type: 'Abnormal Device Activity',    severity: 'warning',  sourceIp: '198.51.100.77', action: 'Dropped',   timestamp: now - 3600000 * 3.2 },
            { id: 'IDS-0005', deviceId: 'API Gateway', type: 'Unauthorized Access Attempt', severity: 'critical', sourceIp: '203.0.113.29',  action: 'Blocked',   timestamp: now - 3600000 * 3.8 },
            { id: 'IDS-0006', deviceId: 'FW-0091',    type: 'Authentication Failure',      severity: 'critical', sourceIp: '198.51.100.23', action: 'Blocked',   timestamp: now - 3600000 * 4.5 },
            { id: 'IDS-0007', deviceId: 'GW-0015',    type: 'Authentication Failure',      severity: 'warning',  sourceIp: '192.0.2.88',    action: 'Monitored', timestamp: now - 3600000 * 5 },
            { id: 'IDS-0008', deviceId: 'Edge Router', type: 'Suspicious Traffic',          severity: 'warning',  sourceIp: '203.0.113.150', action: 'Mitigated', timestamp: now - 3600000 * 6 },
            { id: 'IDS-0009', deviceId: 'SNS-0187',   type: 'Configuration Change',        severity: 'info',     sourceIp: '192.0.2.31',    action: 'Logged',    timestamp: now - 3600000 * 7 }
        ];

        /* Seed alerts (derived from anomalies + intrusions) */
        var seedAlerts = [
            { severity: 'critical', deviceId: 'INV-0042', type: 'Power Surge',     description: 'Unusual power spike — possible grid fault',      timestamp: now - 3600000 * 1,   status: 'active' },
            { severity: 'warning',  deviceId: 'SNS-0187', type: 'Temperature',     description: 'Temperature exceeding threshold (78.4 \u00b0C)',  timestamp: now - 3600000 * 1.5, status: 'investigating' },
            { severity: 'warning',  deviceId: 'GW-0015',  type: 'Network',         description: 'Suspicious network traffic pattern detected',    timestamp: now - 3600000 * 2.5, status: 'investigating' },
            { severity: 'info',     deviceId: 'MTR-0003', type: 'Voltage',         description: 'Voltage fluctuation within acceptable range',    timestamp: now - 3600000 * 4,   status: 'resolved' },
            { severity: 'critical', deviceId: 'FW-0091',  type: 'Security',        description: 'Unauthorized access attempt blocked',            timestamp: now - 3600000 * 2,   status: 'blocked' }
        ];

        /* Seed activity log */
        var seedActivity = [
            { icon: 'ok',       title: 'Device SNS-0203 came online',                   detail: 'Auto-reconnected after firmware update',          timestamp: now - 3600000 * 1.2 },
            { icon: 'settings', title: 'AI anomaly model updated to v3.2.1',             detail: 'Improved detection accuracy by 4.2%',              timestamp: now - 3600000 * 2.5 },
            { icon: 'warning',  title: 'Grid sector B-7 load exceeded 85% threshold',    detail: 'Load balancing automatically activated',           timestamp: now - 3600000 * 3.5 },
            { icon: 'critical', title: 'Blocked unauthorized SSH attempt from 198.51.100.23', detail: 'Firewall rule auto-applied \u2014 IP blacklisted', timestamp: now - 3600000 * 4.5 },
            { icon: 'ok',       title: 'Backup power generator test completed',           detail: 'All 4 generators passed \u2014 ready for failover',   timestamp: now - 3600000 * 6 }
        ];

        /* Generate 24 hours of chart history */
        var chartHistory = generateChartHistory(now);

        return {
            devices:      deepClone(DEFAULT_DEVICES).concat(deepClone(EXTRA_DEVICES)),
            anomalies:    seedAnomalies,
            intrusions:   seedIntrusions,
            alerts:       seedAlerts,
            activity:     seedActivity,
            chartHistory: chartHistory,
            counters: {
                anomalyId:   8,
                intrusionId: 10,
                alertId:     6,
                threatsBlocked: 143
            },
            settings: {
                refreshInterval: 5,
                sensitivity: 'medium',
                confidence: 90
            },
            lastUpdated: now
        };
    }

    /* ------------------------------------------------------------------
       1f. CHART HISTORY GENERATOR
       ------------------------------------------------------------------ */
    function generateChartHistory(now) {
        var points = 24;
        var labels = [];
        var powerConsumption = [];
        var powerGeneration  = [];
        var voltage = [];
        var current = [];
        var tempA   = [];
        var tempB   = [];

        for (var i = 0; i < points; i++) {
            var t = new Date(now - (points - 1 - i) * 3600000);
            labels.push(pad2(t.getHours()) + ':00');

            /* Realistic daily load curve: lower at night, peak midday */
            var hour = t.getHours();
            var baseLoad = 3800 + 1400 * Math.sin((hour - 6) * Math.PI / 12);
            if (baseLoad < 3200) baseLoad = 3200;

            powerConsumption.push(round2(baseLoad + rand(-200, 200)));
            powerGeneration.push(round2(baseLoad + 300 + rand(-150, 150)));
            voltage.push(round2(230 + rand(-2.5, 2.5)));
            current.push(round2(baseLoad / 230 + rand(-1, 1)));
            tempA.push(round2(55 + (baseLoad - 3800) / 100 + rand(-3, 3)));
            tempB.push(round2(50 + (baseLoad - 3800) / 120 + rand(-2, 2)));
        }

        return {
            labels: labels,
            powerConsumption: powerConsumption,
            powerGeneration:  powerGeneration,
            voltage: voltage,
            current: current,
            tempA:   tempA,
            tempB:   tempB
        };
    }

    /* ------------------------------------------------------------------
       1g. STATE MANAGEMENT
       ------------------------------------------------------------------ */
    var _state = null;

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                _state = JSON.parse(raw);
                /* Ensure we have all required fields (migration guard) */
                if (!_state.devices || !_state.anomalies || !_state.chartHistory) {
                    _state = buildInitialState();
                    save();
                }
            } else {
                _state = buildInitialState();
                save();
            }
        } catch (e) {
            _state = buildInitialState();
            save();
        }
        return _state;
    }

    function save() {
        /* In live backend mode the server is the source of truth —
           never overwrite the offline-fallback copy in localStorage. */
        if (_liveMode) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
        } catch (e) {
            /* localStorage may be full or disabled — fail silently */
        }
    }

    function reset() {
        if (_liveMode) {
            /* Live mode: ask the backend to clear its events/history.
               The next live fetch replaces the local state. */
            try {
                fetch('/api/reset', { method: 'POST' })
                    .catch(function () { /* offline — keep state */ });
            } catch (e) { /* ignore */ }
            return _state;
        }
        _state = buildInitialState();
        save();
        return _state;
    }

    function getState() {
        if (!_state) load();
        return _state;
    }

    /* ------------------------------------------------------------------
       1h. PUBLIC QUERY HELPERS
       ------------------------------------------------------------------ */

    function getDevices()                    { return getState().devices; }
    function getMainDevices()               { return getState().devices.slice(0, 5); }
    function getExtraDevices()              { return getState().devices.slice(5); }
    function getDeviceById(id)              { return getState().devices.find(function(d) { return d.deviceId === id; }); }

    function getAnomalies()                 { return getState().anomalies; }
    function getActiveAnomalies()           { return getState().anomalies.filter(function(a) { return a.status !== 'resolved'; }); }
    function getCriticalAnomalies()         { return getActiveAnomalies().filter(function(a) { return a.severity === 'critical'; }); }
    function getResolvedAnomalies()         { return getState().anomalies.filter(function(a) { return a.status === 'resolved'; }); }

    function getIntrusions()                { return getState().intrusions; }
    function getAlerts()                    { return getState().alerts; }
    function getRecentAlerts(n)             { return getState().alerts.slice(0, n || 5); }
    function getActivity()                  { return getState().activity; }
    function getRecentActivity(n)           { return getState().activity.slice(0, n || 5); }
    function getChartHistory()              { return getState().chartHistory; }

    function getDeviceCounts() {
        var devices = getState().devices;
        var total   = devices.length;
        var online  = 0, offline = 0, maintenance = 0;
        for (var i = 0; i < devices.length; i++) {
            if (devices[i].status === 'online')      online++;
            else if (devices[i].status === 'offline') offline++;
            else if (devices[i].status === 'maintenance') maintenance++;
        }
        return { total: total, online: online, offline: offline, maintenance: maintenance };
    }

    function getAggregates() {
        var mains = getMainDevices();
        var totalPower = 0, totalVoltage = 0, totalCurrent = 0, count = 0;
        for (var i = 0; i < mains.length; i++) {
            if (mains[i].status === 'online' || mains[i].status === 'maintenance') {
                totalPower   += mains[i].power;
                totalVoltage += mains[i].voltage;
                totalCurrent += mains[i].current;
                count++;
            }
        }
        return {
            totalPower:   round2(totalPower),
            avgVoltage:   count ? round2(totalVoltage / count) : 0,
            totalCurrent: round2(totalCurrent),
            avgFrequency: mains[0] ? mains[0].frequency : 50
        };
    }

    /* ------------------------------------------------------------------
       1i. MUTATION HELPERS (used by simulation.js)
       ------------------------------------------------------------------ */

    function updateDevice(deviceId, field, value) {
        var dev = getDeviceById(deviceId);
        if (dev) {
            dev[field] = value;
            dev._lastUpdate = Date.now();
        }
    }

    function addAnomaly(anomaly) {
        _state.anomalies.unshift(anomaly);
        /* Keep max 50 */
        if (_state.anomalies.length > 50) _state.anomalies = _state.anomalies.slice(0, 50);
    }

    function addIntrusion(event) {
        _state.intrusions.unshift(event);
        if (_state.intrusions.length > 50) _state.intrusions = _state.intrusions.slice(0, 50);
    }

    function addAlert(alert) {
        _state.alerts.unshift(alert);
        if (_state.alerts.length > 30) _state.alerts = _state.alerts.slice(0, 30);
    }

    function addActivity(entry) {
        _state.activity.unshift(entry);
        if (_state.activity.length > 30) _state.activity = _state.activity.slice(0, 30);
    }

    function pushChartPoint(label, data) {
        var ch = _state.chartHistory;
        ch.labels.push(label);
        ch.powerConsumption.push(data.powerConsumption);
        ch.powerGeneration.push(data.powerGeneration);
        ch.voltage.push(data.voltage);
        ch.current.push(data.current);
        ch.tempA.push(data.tempA);
        ch.tempB.push(data.tempB);
        /* Keep max 48 points */
        if (ch.labels.length > 48) {
            ch.labels.shift();
            ch.powerConsumption.shift();
            ch.powerGeneration.shift();
            ch.voltage.shift();
            ch.current.shift();
            ch.tempA.shift();
            ch.tempB.shift();
        }
    }

    function incrementThreatsBlocked() {
        _state.counters.threatsBlocked++;
    }

    function nextAnomalyId() {
        var id = 'ANM-' + pad4(_state.counters.anomalyId++);
        return id;
    }

    function nextIntrusionId() {
        var id = 'IDS-' + pad4(_state.counters.intrusionId++);
        return id;
    }

    function markAnomalyResolved(anomalyId) {
        var anomalies = _state.anomalies;
        for (var i = 0; i < anomalies.length; i++) {
            if (anomalies[i].id === anomalyId) {
                anomalies[i].status = 'resolved';
                break;
            }
        }
    }

    /* ------------------------------------------------------------------
       1j. SETTINGS HELPERS
       ------------------------------------------------------------------ */
    function getSettings() {
        return getState().settings;
    }

    function updateSettings(partial) {
        for (var key in partial) {
            if (partial.hasOwnProperty(key)) {
                _state.settings[key] = partial[key];
            }
        }
        if (_liveMode) {
            /* Live mode: persist settings on the backend too */
            try {
                fetch('/api/settings', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(partial)
                }).catch(function () { /* offline — local copy still applied */ });
            } catch (e) { /* ignore */ }
            return;
        }
        save();
    }

    /* ------------------------------------------------------------------
       1k. UTILITY HELPERS
       ------------------------------------------------------------------ */
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function pad4(n) { return n < 10 ? '000' + n : n < 100 ? '00' + n : n < 1000 ? '0' + n : '' + n; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function rand(min, max) { return min + Math.random() * (max - min); }
    function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

    /* ------------------------------------------------------------------
       1l. LIVE BACKEND MODE (REST/SSE adapter)
       ------------------------------------------------------------------
       When the local Python backend (backend/server.py) is reachable,
       the dashboard switches to LIVE MODE:

         • _state is fetched from  GET /api/state  — real telemetry that
           arrived over MQTT from the C++ edge simulator.
         • 'tick' Server-Sent Events from  GET /api/events  trigger an
           immediate refresh (plus a 5 s safety poll).
         • The in-browser fake simulation (simulation.js) is stopped so
           random data can never overwrite real telemetry.
         • localStorage is only used when the backend is NOT reachable
           (offline fallback — exactly the original behaviour).

       The public API of GridGuardData does not change, so dashboard.js
       and charts.js work unmodified in both modes.
       ------------------------------------------------------------------ */
    var _liveMode         = false;
    var _liveEventSource  = null;
    var _liveFetchBusy    = false;
    var _liveSseDebounce  = null;

    function isLiveMode() {
        return _liveMode;
    }

    /* Switch from fallback mode to live mode (live data wins) */
    function enterLiveMode(serverState) {
        var wasLive = _liveMode;
        _liveMode = true;
        _state    = serverState;

        if (!wasLive) {
            /* Stop the fake in-browser simulation engine so it cannot
               overwrite real telemetry with random values. */
            if (typeof GridGuardSimulation !== 'undefined' &&
                GridGuardSimulation &&
                typeof GridGuardSimulation.stop === 'function') {
                try { GridGuardSimulation.stop(); } catch (e) { /* ignore */ }
            }
        }

        /* Refresh charts immediately if the chart manager is loaded */
        if (typeof GridGuardCharts !== 'undefined' &&
            GridGuardCharts &&
            typeof GridGuardCharts.update === 'function') {
            try { GridGuardCharts.update(); } catch (e) { /* ignore */ }
        }
    }

    /* Fetch the current state from the backend */
    function fetchLiveState() {
        if (_liveFetchBusy) return;
        _liveFetchBusy = true;

        fetch('/api/state', { cache: 'no-store' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (data && data.devices) {
                    if (_liveMode) {
                        _state = data;          /* live → live refresh   */
                    } else {
                        enterLiveMode(data);    /* fallback → live switch */
                    }
                }
                _liveFetchBusy = false;
            })
            .catch(function () {
                /* Backend unreachable:
                   • already live → keep the last known real state
                     (never fall back to fake data mid-session);
                   • not live yet → stay in localStorage fallback mode. */
                _liveFetchBusy = false;
            });
    }

    /* Begin live sync: initial fetch + SSE push + safety polling */
    function startLiveSync() {
        /* Initial fetch decides whether live mode is available */
        fetchLiveState();

        /* Server-Sent Events: a 'tick' arrives after every simulator
           telemetry batch — refetch the state (debounced 1 s). */
        if (typeof EventSource !== 'undefined') {
            try {
                _liveEventSource = new EventSource('/api/events');
                _liveEventSource.addEventListener('tick', function () {
                    if (_liveSseDebounce) clearTimeout(_liveSseDebounce);
                    _liveSseDebounce = setTimeout(fetchLiveState, 1000);
                });
            } catch (e) {
                _liveEventSource = null;
            }
        }

        /* Safety poll — picks up live mode if the backend starts later,
           and keeps data flowing if SSE is unavailable. Skipped while
           the tab is hidden to avoid needless requests. */
        setInterval(function () {
            if (typeof document === 'undefined' ||
                document.visibilityState !== 'hidden') {
                fetchLiveState();
            }
        }, 5000);
    }

    /* ------------------------------------------------------------------
       1m. PUBLIC API
       ------------------------------------------------------------------ */
    return {
        load:               load,
        save:               save,
        reset:              reset,
        getState:           getState,

        /* Queries */
        getDevices:         getDevices,
        getMainDevices:     getMainDevices,
        getExtraDevices:    getExtraDevices,
        getDeviceById:      getDeviceById,
        getDeviceCounts:    getDeviceCounts,
        getAggregates:      getAggregates,
        getAnomalies:       getAnomalies,
        getActiveAnomalies: getActiveAnomalies,
        getCriticalAnomalies: getCriticalAnomalies,
        getResolvedAnomalies: getResolvedAnomalies,
        getIntrusions:      getIntrusions,
        getAlerts:          getAlerts,
        getRecentAlerts:    getRecentAlerts,
        getActivity:        getActivity,
        getRecentActivity:  getRecentActivity,
        getChartHistory:    getChartHistory,
        getSettings:        getSettings,

        /* Mutations */
        updateDevice:       updateDevice,
        addAnomaly:         addAnomaly,
        addIntrusion:       addIntrusion,
        addAlert:           addAlert,
        addActivity:        addActivity,
        pushChartPoint:     pushChartPoint,
        incrementThreatsBlocked: incrementThreatsBlocked,
        nextAnomalyId:      nextAnomalyId,
        nextIntrusionId:    nextIntrusionId,
        markAnomalyResolved: markAnomalyResolved,
        updateSettings:     updateSettings,

        /* Live backend mode (REST/SSE — see section 1l) */
        isLiveMode:         isLiveMode,
        startLiveSync:      startLiveSync,

        /* Constants */
        ANOMALY_TYPES:      ANOMALY_TYPES,
        INTRUSION_TYPES:    INTRUSION_TYPES,
        ATTACK_IPS:         ATTACK_IPS,

        /* Utilities */
        pad2: pad2, pad4: pad4, round2: round2, rand: rand
    };

})();

/* Auto-load on script evaluation */
GridGuardData.load();

/* Try to enter live backend mode. Falls back silently to the
   localStorage simulation when the local backend is not running
   (see section 1l in data.js). */
GridGuardData.startLiveSync();
