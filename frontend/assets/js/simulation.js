/* ========================================================================
   GRIDGUARD AI — Simulation Engine (simulation.js)
   ========================================================================
   Drives realistic, gradually-changing grid data on the frontend.

   Intervals:
     • 2 s  — drift device metrics (voltage, current, power, temperature)
     • 5 s  — update chart history with latest aggregated values
     • 30 s — chance of generating an anomaly / intrusion event
     • 10 s — persist state to localStorage

   The engine is intentionally simple so beginners can follow the logic.
   ======================================================================== */

var GridGuardSimulation = (function () {

    var _timers = [];
    var _running = false;

    /* ------------------------------------------------------------------
       HELPERS (delegate to data layer where possible)
       ------------------------------------------------------------------ */
    var round2 = GridGuardData.round2;
    var rand   = GridGuardData.rand;
    var pad2   = GridGuardData.pad2;

    /* Clamp a value between min and max */
    function clamp(val, min, max) {
        return val < min ? min : val > max ? max : val;
    }

    /* Small random walk: current ± step, clamped */
    function drift(current, step, min, max) {
        return clamp(round2(current + rand(-step, step)), min, max);
    }

    /* ------------------------------------------------------------------
       1. DEVICE METRIC DRIFT  (every 2 s)
       ------------------------------------------------------------------ */
    function tickDeviceMetrics() {
        var devices = GridGuardData.getMainDevices();

        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];

            /* Skip offline devices — their metrics stay at zero / last value */
            if (d.status === 'offline') continue;

            /* Sensors and gateways don't have power metrics */
            if (d.type === 'Sensor' || d.type === 'Gateway' || d.type === 'Security') {
                d.temperature = drift(d.temperature, 0.3, 25, 85);
                continue;
            }

            /* Gradual voltage drift (230 V nominal ±4 V) */
            d.voltage     = drift(d.voltage, 0.3, 224, 236);
            d.current     = drift(d.current, 0.2, 5, 28);
            d.power       = round2(d.voltage * d.current);
            d.temperature = drift(d.temperature, 0.4, 30, 82);
            d.frequency   = drift(d.frequency, 0.01, 49.90, 50.10);
        }

        /* Also drift extra devices that have power */
        var extras = GridGuardData.getExtraDevices();
        for (var j = 0; j < extras.length; j++) {
            var e = extras[j];
            if (e.status === 'offline') continue;
            if (e.type === 'Sensor' || e.type === 'Gateway' || e.type === 'Security' || e.type === 'Storage' || e.type === 'Breaker') {
                e.temperature = drift(e.temperature, 0.2, 20, 85);
                continue;
            }
            e.voltage     = drift(e.voltage, 0.2, 224, 236);
            e.current     = drift(e.current, 0.15, 5, 28);
            e.power       = round2(e.voltage * e.current);
            e.temperature = drift(e.temperature, 0.3, 30, 82);
        }
    }

    /* ------------------------------------------------------------------
       2. CHART HISTORY UPDATE  (every 5 s — add latest aggregated point)
       ------------------------------------------------------------------ */
    function tickChartHistory() {
        var agg = GridGuardData.getAggregates();
        var now = new Date();
        var label = pad2(now.getHours()) + ':' + pad2(now.getMinutes());

        /* Compute average temperatures from main devices */
        var mains = GridGuardData.getMainDevices();
        var tA = 0, tB = 0, countA = 0, countB = 0;
        for (var i = 0; i < mains.length; i++) {
            if (i < 3) { tA += mains[i].temperature; countA++; }
            else       { tB += mains[i].temperature; countB++; }
        }

        GridGuardData.pushChartPoint(label, {
            powerConsumption: agg.totalPower,
            powerGeneration:  round2(agg.totalPower + rand(-200, 300)),
            voltage:          agg.avgVoltage,
            current:          agg.totalCurrent,
            tempA:            countA ? round2(tA / countA) : 55,
            tempB:            countB ? round2(tB / countB) : 50
        });
    }

    /* ------------------------------------------------------------------
       3. RANDOM EVENT GENERATION  (every 30 s — low probability)
       ------------------------------------------------------------------ */
    function tickRandomEvents() {
        /* 20% chance per tick to generate an event */
        if (Math.random() > 0.20) return;

        var roll = Math.random();
        if (roll < 0.50) {
            generateAnomalyEvent();
        } else if (roll < 0.80) {
            generateIntrusionEvent();
        } else {
            generateDeviceEvent();
        }
    }

    /* ----- Anomaly ----- */
    function generateAnomalyEvent() {
        var devices = GridGuardData.getDevices();
        var target  = devices[Math.floor(Math.random() * devices.length)];
        var types   = GridGuardData.ANOMALY_TYPES;
        var type    = types[Math.floor(Math.random() * types.length)];

        /* Determine severity */
        var sevRoll = Math.random();
        var severity = sevRoll < 0.15 ? 'critical' : sevRoll < 0.50 ? 'warning' : 'info';

        /* Build description */
        var descriptions = {
            'Voltage Spike':    'Voltage spike detected on ' + target.deviceId + ' (' + round2(target.voltage + rand(5, 15)) + ' V)',
            'Voltage Drop':     'Voltage drop on ' + target.deviceId + ' (' + round2(target.voltage - rand(5, 15)) + ' V)',
            'High Current':     'Current exceeded safe threshold on ' + target.deviceId,
            'Excessive Power':  'Power consumption anomaly on ' + target.deviceId,
            'High Temperature': 'Temperature above threshold on ' + target.deviceId + ' (' + round2(target.temperature + rand(5, 12)) + ' \u00b0C)',
            'Device Offline':   target.deviceId + ' went offline unexpectedly',
            'Unusual Activity': 'Unusual telemetry pattern detected on ' + target.deviceId
        };

        var anomaly = {
            id:          GridGuardData.nextAnomalyId(),
            deviceId:    target.deviceId,
            type:        type,
            severity:    severity,
            description: descriptions[type] || 'Anomaly detected on ' + target.deviceId,
            confidence:  round2(rand(80, 99)),
            status:      severity === 'critical' ? 'active' : 'investigating',
            timestamp:   Date.now()
        };

        GridGuardData.addAnomaly(anomaly);

        /* Also add to alerts */
        GridGuardData.addAlert({
            severity:    severity,
            deviceId:    target.deviceId,
            type:        type,
            description: anomaly.description,
            timestamp:   Date.now(),
            status:      severity === 'critical' ? 'active' : 'investigating'
        });

        /* Add to activity feed */
        var icon = severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'ok';
        GridGuardData.addActivity({
            icon:      icon,
            title:     type + ' on ' + target.deviceId,
            detail:    anomaly.description,
            timestamp: Date.now()
        });
    }

    /* ----- Intrusion ----- */
    function generateIntrusionEvent() {
        var devices    = GridGuardData.getDevices();
        var target     = devices[Math.floor(Math.random() * devices.length)];
        var types      = GridGuardData.INTRUSION_TYPES;
        var type       = types[Math.floor(Math.random() * types.length)];
        var ips        = GridGuardData.ATTACK_IPS;
        var sourceIp   = ips[Math.floor(Math.random() * ips.length)];

        var sevRoll  = Math.random();
        var severity = sevRoll < 0.25 ? 'critical' : sevRoll < 0.60 ? 'warning' : 'info';

        var actions  = severity === 'critical' ? 'Blocked' : severity === 'warning' ? 'Monitored' : 'Logged';

        var event = {
            id:        GridGuardData.nextIntrusionId(),
            deviceId:  target.deviceId,
            type:      type,
            severity:  severity,
            sourceIp:  sourceIp,
            action:    actions,
            timestamp: Date.now()
        };

        GridGuardData.addIntrusion(event);

        /* Also create a corresponding alert */
        GridGuardData.addAlert({
            severity:    severity,
            deviceId:    target.deviceId,
            type:        'Security',
            description: type + ' from ' + sourceIp + ' on ' + target.deviceId,
            timestamp:   Date.now(),
            status:      actions.toLowerCase()
        });

        /* Activity feed */
        GridGuardData.addActivity({
            icon:      severity === 'critical' ? 'critical' : 'warning',
            title:     'Security: ' + type + ' on ' + target.deviceId,
            detail:    'Source: ' + sourceIp + ' \u2014 Action: ' + actions,
            timestamp: Date.now()
        });

        if (severity === 'critical') {
            GridGuardData.incrementThreatsBlocked();
        }
    }

    /* ----- Device status event ----- */
    function generateDeviceEvent() {
        var events = [
            { icon: 'ok',      title: 'Device reconnected successfully',       detail: 'Telemetry stream resumed' },
            { icon: 'warning', title: 'Load balancing activated on sector',     detail: 'Automatic redistribution in progress' },
            { icon: 'ok',      title: 'Firmware update completed',             detail: 'All devices running latest version' },
            { icon: 'settings', title: 'AI scan cycle completed',              detail: 'No new threats detected this cycle' },
            { icon: 'ok',      title: 'Generator self-test passed',            detail: 'Backup systems nominal' }
        ];

        var evt = events[Math.floor(Math.random() * events.length)];
        GridGuardData.addActivity({
            icon:      evt.icon,
            title:     evt.title,
            detail:    evt.detail,
            timestamp: Date.now()
        });
    }

    /* ------------------------------------------------------------------
       4. PERSIST STATE  (every 10 s)
       ------------------------------------------------------------------ */
    function tickSave() {
        GridGuardData.save();
    }

    /* ------------------------------------------------------------------
       5. PUBLIC API — start / stop / reset
       ------------------------------------------------------------------ */

    function start() {
        if (_running) return;

        /* Live backend mode: real MQTT telemetry (via backend/server.py)
           drives the dashboard — the fake simulation must NOT run, or
           random values would overwrite real data. See the live-mode
           adapter in data.js (section 1l). */
        if (GridGuardData.isLiveMode && GridGuardData.isLiveMode()) {
            return;
        }

        _running = true;

        _timers.push(setInterval(tickDeviceMetrics,  2000));
        _timers.push(setInterval(tickChartHistory,   5000));
        _timers.push(setInterval(tickRandomEvents,   30000));
        _timers.push(setInterval(tickSave,           10000));
    }

    function stop() {
        for (var i = 0; i < _timers.length; i++) {
            clearInterval(_timers[i]);
        }
        _timers = [];
        _running = false;
    }

    function isRunning() {
        return _running;
    }

    function resetSimulation() {
        stop();
        GridGuardData.reset();
        start();
    }

    return {
        start:  start,
        stop:   stop,
        isRunning: isRunning,
        reset:  resetSimulation
    };

})();
