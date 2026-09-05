/* ========================================================================
   GRIDGUARD AI — Dashboard Orchestrator (dashboard.js)
   ========================================================================
   This is the main entry point that ties together:
     • GridGuardData        (data.js)
     • GridGuardSimulation   (simulation.js)
     • GridGuardCharts      (charts.js)

   It detects the current page, initialises the right features, and
   drives all DOM updates from the centralised data layer.
   ======================================================================== */

(function () {
    'use strict';

    /* ==================================================================
       1. PAGE DETECTION
       ================================================================== */
    var path = window.location.pathname;
    var page = 'overview';  /* default */
    if (path.indexOf('live-monitoring')  !== -1) page = 'live-monitoring';
    else if (path.indexOf('devices')     !== -1) page = 'devices';
    else if (path.indexOf('anomalies')   !== -1) page = 'anomalies';
    else if (path.indexOf('intrusion')   !== -1) page = 'intrusion';
    else if (path.indexOf('analytics')   !== -1) page = 'analytics';
    else if (path.indexOf('settings')    !== -1) page = 'settings';


    /* ==================================================================
       2. LIVE DATE / TIME  (kept from original)
       ================================================================== */
    function updateDateTime() {
        var el = document.getElementById('header-datetime');
        if (!el) return;

        var now     = new Date();
        var dateStr = now.toLocaleDateString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
        var timeStr = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });

        el.textContent = dateStr + '  ' + timeStr;
    }

    updateDateTime();
    setInterval(updateDateTime, 1000);


    /* ==================================================================
       3. MOBILE SIDEBAR TOGGLE  (kept from original)
       ================================================================== */
    (function () {
        var toggle  = document.getElementById('sidebar-toggle');
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebar-overlay');

        if (!toggle || !sidebar || !overlay) return;

        function checkViewport() {
            if (window.innerWidth < 1024) {
                toggle.style.display = 'flex';
            } else {
                toggle.style.display = 'none';
                sidebar.classList.remove('gg-sidebar--open');
                overlay.classList.remove('gg-sidebar-overlay--visible');
            }
        }

        toggle.addEventListener('click', function () {
            sidebar.classList.toggle('gg-sidebar--open');
            overlay.classList.toggle('gg-sidebar-overlay--visible');
        });

        overlay.addEventListener('click', function () {
            sidebar.classList.remove('gg-sidebar--open');
            overlay.classList.remove('gg-sidebar-overlay--visible');
        });

        window.addEventListener('resize', checkViewport);
        checkViewport();
    })();


    /* ==================================================================
       4. HELPER — format time
       ================================================================== */
    function formatTime(ts) {
        var d = new Date(ts);
        return GridGuardData.pad2(d.getHours()) + ':' +
               GridGuardData.pad2(d.getMinutes()) + ':' +
               GridGuardData.pad2(d.getSeconds());
    }

    function formatRelative(ts) {
        var diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60)    return diff + ' sec ago';
        if (diff < 3600)  return Math.floor(diff / 60) + ' min ago';
        return Math.floor(diff / 3600) + ' hr ago';
    }

    function formatNumber(n) {
        return n.toLocaleString('en-US');
    }

    function severityBadge(severity) {
        var cls = 'gg-badge--info';
        if (severity === 'critical') cls = 'gg-badge--critical';
        else if (severity === 'warning') cls = 'gg-badge--warning';
        else if (severity === 'ok') cls = 'gg-badge--ok';
        return '<span class="gg-badge ' + cls + '">' + severity.charAt(0).toUpperCase() + severity.slice(1) + '</span>';
    }

    function statusBadge(status) {
        var cls = 'gg-badge--info';
        if (status === 'active')       cls = 'gg-badge--critical';
        else if (status === 'investigating') cls = 'gg-badge--warning';
        else if (status === 'resolved' || status === 'blocked') cls = 'gg-badge--ok';
        else if (status === 'online')  cls = 'gg-badge--ok';
        else if (status === 'offline') cls = 'gg-badge--critical';
        else if (status === 'maintenance') cls = 'gg-badge--warning';
        return '<span class="gg-badge ' + cls + '">' +
               (status === 'online' || status === 'offline' || status === 'maintenance'
                   ? '<span class="gg-status-dot gg-status-dot--' +
                     (status === 'online' ? 'ok' : status === 'offline' ? 'critical' : 'warning') +
                     (status === 'online' ? ' gg-status-dot--pulse' : '') + '"></span>'
                   : '') +
               status.charAt(0).toUpperCase() + status.slice(1) + '</span>';
    }

    function iconSvg(type) {
        var svgs = {
            ok:       '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
            warning:  '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
            critical: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.057 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2A11.954 11.954 0 0110 1.944z" clip-rule="evenodd"/></svg>',
            settings: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>',
            info:     '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>'
        };
        return svgs[type] || svgs.info;
    }

    function iconBg(icon) {
        var bgs = {
            ok:       'background: var(--status-ok-bg); color: var(--status-ok);',
            warning:  'background: var(--status-warning-bg); color: var(--status-warning);',
            critical: 'background: var(--status-critical-bg); color: var(--status-critical);',
            settings: 'background: var(--accent-cyan-muted); color: var(--accent-cyan);',
            info:     ''
        };
        return bgs[icon] || '';
    }


    /* ==================================================================
       5. KPI & DOM UPDATERS
       ================================================================== */

    /* --- Update text inside a #id .gg-metric-card__value element --- */
    function setMetricValue(id, value) {
        var el = document.querySelector('#' + id + ' .gg-metric-card__value');
        if (el) el.textContent = typeof value === 'number' ? formatNumber(value) : value;
    }

    /* ---- Overview page KPIs ---- */
    function updateOverviewKPIs() {
        var counts = GridGuardData.getDeviceCounts();
        var agg    = GridGuardData.getAggregates();
        var active = GridGuardData.getActiveAnomalies();
        var crits  = GridGuardData.getCriticalAnomalies();

        setMetricValue('kpi-total-devices',  counts.total);
        setMetricValue('kpi-active-devices', counts.online);

        /* Update the "/ N" unit */
        var unitEl = document.querySelector('#kpi-active-devices .gg-metric-card__unit');
        if (unitEl) unitEl.textContent = '/ ' + counts.total;

        /* Status bar width */
        var bar = document.querySelector('#kpi-active-devices .gg-status-bar__fill');
        if (bar) bar.style.width = Math.round(counts.online / counts.total * 100) + '%';

        setMetricValue('kpi-current-power', formatNumber(agg.totalPower));
        setMetricValue('kpi-avg-voltage',   agg.avgVoltage);
        setMetricValue('kpi-anomalies',     active.length);
        setMetricValue('kpi-threats',       crits.length);
    }

    /* ---- System status section ---- */
    function updateSystemStatus() {
        var counts = GridGuardData.getDeviceCounts();
        var agg    = GridGuardData.getAggregates();
        var state  = GridGuardData.getState();

        var freqEl   = document.getElementById('grid-frequency');
        var pfEl     = document.getElementById('power-factor');
        var loadEl   = document.getElementById('grid-load');
        var loadBar  = document.getElementById('grid-load-bar');
        var healthEl = document.getElementById('grid-health-time');

        if (freqEl) freqEl.textContent = agg.avgFrequency.toFixed(2) + ' Hz';
        if (pfEl)   pfEl.textContent   = (0.95 + Math.random() * 0.04).toFixed(2);

        var loadPct = Math.round(agg.totalPower / 7000 * 100);
        if (loadEl)  loadEl.textContent  = loadPct + '%';
        if (loadBar) loadBar.style.width = loadPct + '%';

        if (healthEl) healthEl.textContent = 'just now';

        /* Device connectivity */
        var onlineEl  = document.getElementById('devices-online');
        var offlineEl = document.getElementById('devices-offline');
        var maintEl   = document.getElementById('devices-maintenance');

        if (onlineEl)  onlineEl.textContent  = counts.online;
        if (offlineEl) offlineEl.textContent = counts.offline;
        if (maintEl)   maintEl.textContent   = counts.maintenance;

        /* Threats blocked */
        var threatsEl = document.getElementById('threats-blocked');
        if (threatsEl) threatsEl.textContent = state.counters.threatsBlocked;
    }

    /* ---- Recent alerts table ---- */
    function updateAlertsTable() {
        var tbody = document.querySelector('#alerts-table tbody');
        if (!tbody) return;

        var alerts = GridGuardData.getRecentAlerts(5);
        var html = '';

        for (var i = 0; i < alerts.length; i++) {
            var a = alerts[i];
            html += '<tr>' +
                '<td>' + severityBadge(a.severity) + '</td>' +
                '<td class="text-mono">' + a.deviceId + '</td>' +
                '<td>' + a.description + '</td>' +
                '<td class="text-mono text-tertiary" style="font-size:var(--text-xs);">' + formatTime(a.timestamp) + '</td>' +
                '<td>' + statusBadge(a.status) + '</td>' +
                '</tr>';
        }

        tbody.innerHTML = html;
    }

    /* ---- Activity feed ---- */
    function updateActivityFeed() {
        var container = document.getElementById('activity-list');
        if (!container) return;

        var items = GridGuardData.getRecentActivity(5);
        var html = '';

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            html += '<div class="gg-device-item">' +
                '<div class="gg-device-item__icon" style="' + iconBg(item.icon) + '">' +
                    iconSvg(item.icon) +
                '</div>' +
                '<div class="gg-device-item__info">' +
                    '<div class="gg-device-item__name">' + item.title + '</div>' +
                    '<div class="gg-device-item__meta">' + item.detail + '</div>' +
                '</div>' +
                '<span class="text-mono text-tertiary" style="font-size:var(--text-xs); flex-shrink:0;">' +
                    formatTime(item.timestamp) +
                '</span>' +
                '</div>';
        }

        container.innerHTML = html;
    }


    /* ==================================================================
       6. LIVE MONITORING PAGE
       ================================================================== */
    function updateLiveMetrics() {
        var agg = GridGuardData.getAggregates();

        setMetricValue('live-voltage',  agg.avgVoltage);
        setMetricValue('live-current',  agg.totalCurrent);
        setMetricValue('live-power',    formatNumber(agg.totalPower));
        setMetricValue('live-frequency', agg.avgFrequency.toFixed(2));
    }


    /* ==================================================================
       7. DEVICES PAGE
       ================================================================== */
    function renderDevicesTable(filterStatus, searchTerm) {
        var tbody = document.querySelector('#devices-table tbody');
        if (!tbody) return;

        var allDevices = GridGuardData.getDevices();
        var filtered = [];

        for (var i = 0; i < allDevices.length; i++) {
            var d = allDevices[i];
            if (filterStatus && filterStatus !== 'all' && d.status !== filterStatus) continue;
            if (searchTerm) {
                var term = searchTerm.toLowerCase();
                if (d.deviceId.toLowerCase().indexOf(term) === -1 &&
                    d.name.toLowerCase().indexOf(term) === -1 &&
                    d.type.toLowerCase().indexOf(term) === -1 &&
                    d.location.toLowerCase().indexOf(term) === -1) continue;
            }
            filtered.push(d);
        }

        var html = '';
        for (var j = 0; j < filtered.length; j++) {
            var dev = filtered[j];
            html += '<tr>' +
                '<td class="text-mono">' + dev.deviceId + '</td>' +
                '<td>' + dev.name + '</td>' +
                '<td>' + dev.type + '</td>' +
                '<td>' + dev.sector + '</td>' +
                '<td>' + statusBadge(dev.status) + '</td>' +
                '<td class="text-mono text-tertiary" style="font-size:var(--text-xs);">' +
                    (dev._lastUpdate ? formatRelative(dev._lastUpdate) : formatRelative(Date.now())) +
                '</td>' +
                '</tr>';
        }

        tbody.innerHTML = html;

        /* Update footer count */
        var footer = document.querySelector('#device-registry-panel .gg-card__footer');
        if (footer) footer.textContent = 'Showing ' + filtered.length + ' of ' + allDevices.length + ' registered devices';
    }

    function initDevicesPage() {
        var searchInput = document.getElementById('device-search');
        var filterSelect = document.getElementById('device-filter');
        var refreshBtn  = document.getElementById('btn-refresh-devices');

        function refresh() {
            var status = filterSelect ? filterSelect.value : 'all';
            var search = searchInput ? searchInput.value : '';
            renderDevicesTable(status, search);
        }

        if (searchInput) searchInput.addEventListener('input', refresh);
        if (filterSelect) filterSelect.addEventListener('change', refresh);
        if (refreshBtn)   refreshBtn.addEventListener('click', refresh);

        /* Device summary cards */
        updateDeviceSummaryCards();
        refresh();
    }

    function updateDeviceSummaryCards() {
        var counts = GridGuardData.getDeviceCounts();
        setMetricValue('devices-online-card',      counts.online);
        setMetricValue('devices-offline-card',     counts.offline);
        setMetricValue('devices-maintenance-card', counts.maintenance);
    }


    /* ==================================================================
       8. ANOMALIES PAGE
       ================================================================== */
    function renderAnomaliesTable() {
        var tbody = document.querySelector('#anomalies-table tbody');
        if (!tbody) return;

        var anomalies = GridGuardData.getAnomalies();
        var html = '';

        for (var i = 0; i < anomalies.length && i < 15; i++) {
            var a = anomalies[i];
            html += '<tr>' +
                '<td>' + severityBadge(a.severity) + '</td>' +
                '<td class="text-mono">' + a.deviceId + '</td>' +
                '<td>' + a.type + '</td>' +
                '<td>' + a.description + '</td>' +
                '<td class="text-mono">' + a.confidence.toFixed(1) + '%</td>' +
                '<td class="text-mono text-tertiary" style="font-size:var(--text-xs);">' + formatTime(a.timestamp) + '</td>' +
                '<td>' + statusBadge(a.status) + '</td>' +
                '</tr>';
        }

        tbody.innerHTML = html;

        /* KPIs */
        var active   = GridGuardData.getActiveAnomalies();
        var critical = GridGuardData.getCriticalAnomalies();
        var resolved = GridGuardData.getResolvedAnomalies();
        var investigating = active.filter(function(a) { return a.status === 'investigating'; });

        setMetricValue('kpi-total-anomalies',    active.length);
        setMetricValue('kpi-critical-anomalies', critical.length);
        setMetricValue('kpi-investigating',      investigating.length);
        setMetricValue('kpi-resolved',           resolved.length);
    }

    function initAnomaliesPage() {
        var exportBtn = document.getElementById('btn-export-anomalies');
        if (exportBtn) {
            exportBtn.addEventListener('click', function () {
                exportTableCSV('anomalies-table', 'gridguard-anomalies.csv');
            });
        }
        renderAnomaliesTable();
    }


    /* ==================================================================
       9. INTRUSION LOGS PAGE
       ================================================================== */
    function renderIntrusionTable(severityFilter) {
        var tbody = document.querySelector('#intrusion-table tbody');
        if (!tbody) return;

        var intrusions = GridGuardData.getIntrusions();
        var filtered = severityFilter && severityFilter !== 'all'
            ? intrusions.filter(function(e) { return e.severity === severityFilter; })
            : intrusions;

        var html = '';
        for (var i = 0; i < filtered.length && i < 15; i++) {
            var e = filtered[i];
            html += '<tr>' +
                '<td class="text-mono text-tertiary" style="font-size:var(--text-xs);">' + formatTime(e.timestamp) + '</td>' +
                '<td class="text-mono">' + e.sourceIp + '</td>' +
                '<td class="text-mono">' + e.deviceId + '</td>' +
                '<td>' + e.type + '</td>' +
                '<td>' + statusBadge(e.action.toLowerCase()) + '</td>' +
                '<td>' + severityBadge(e.severity) + '</td>' +
                '</tr>';
        }

        tbody.innerHTML = html;

        /* Update security summary KPIs */
        var state    = GridGuardData.getState();
        var active   = GridGuardData.getActiveAnomalies().filter(function(a) { return a.severity === 'critical'; });

        setMetricValue('kpi-blocked-attempts', state.counters.threatsBlocked);
        setMetricValue('kpi-active-threats',   active.length);
    }

    function initIntrusionPage() {
        var filterSelect = document.getElementById('log-severity-filter');
        var exportBtn    = document.getElementById('btn-export-logs');

        if (filterSelect) {
            filterSelect.addEventListener('change', function () {
                renderIntrusionTable(this.value);
            });
        }
        if (exportBtn) {
            exportBtn.addEventListener('click', function () {
                exportTableCSV('intrusion-table', 'gridguard-intrusion-logs.csv');
            });
        }

        renderIntrusionTable('all');
    }


    /* ==================================================================
       10. ANALYTICS PAGE
       ================================================================== */
    function initAnalyticsPage() {
        var exportBtn = document.getElementById('btn-export-report');
        if (exportBtn) {
            exportBtn.addEventListener('click', function () {
                exportTableCSV('monthly-stats-table', 'gridguard-monthly-report.csv');
            });
        }

        /* Update analytics KPIs from data */
        var agg = GridGuardData.getAggregates();
        var anomalies = GridGuardData.getAnomalies();

        setMetricValue('kpi-total-energy',    round1(agg.totalPower * 24 / 1000));
        setMetricValue('kpi-peak-demand',     round1(agg.totalPower * 1.15 / 1000));
        setMetricValue('kpi-avg-consumption', formatNumber(Math.round(agg.totalPower * 0.97)));
    }

    function round1(n) { return Math.round(n * 10) / 10; }


    /* ==================================================================
       11. SETTINGS PAGE
       ================================================================== */
    function initSettingsPage() {
        var saveBtn  = document.getElementById('btn-save-settings');
        var resetBtn = document.getElementById('btn-reset-settings');

        /* Load current settings into form controls */
        var settings = GridGuardData.getSettings();
        var refreshSelect  = document.getElementById('setting-refresh');
        var sensitivitySel = document.getElementById('setting-sensitivity');
        var confidenceSel  = document.getElementById('setting-confidence');

        if (refreshSelect)  refreshSelect.value  = settings.refreshInterval || '5';
        if (sensitivitySel) sensitivitySel.value  = settings.sensitivity || 'medium';
        if (confidenceSel)  confidenceSel.value   = settings.confidence || 90;

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var newSettings = {};
                if (refreshSelect)  newSettings.refreshInterval = parseInt(refreshSelect.value, 10) || 5;
                if (sensitivitySel) newSettings.sensitivity     = sensitivitySel.value;
                if (confidenceSel)  newSettings.confidence      = parseInt(confidenceSel.value, 10) || 90;

                GridGuardData.updateSettings(newSettings);
                showSaveConfirmation(saveBtn);
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                GridGuardSimulation.reset();
                /* Reload form values */
                var defaults = GridGuardData.getSettings();
                if (refreshSelect)  refreshSelect.value  = defaults.refreshInterval;
                if (sensitivitySel) sensitivitySel.value = defaults.sensitivity;
                if (confidenceSel)  confidenceSel.value  = defaults.confidence;
            });
        }
    }

    function showSaveConfirmation(btn) {
        var originalText = btn.innerHTML;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg> Saved!';
        btn.style.borderColor = 'var(--status-ok)';
        setTimeout(function () {
            btn.innerHTML = originalText;
            btn.style.borderColor = '';
        }, 2000);
    }


    /* ==================================================================
       12. CSV EXPORT HELPER
       ================================================================== */
    function exportTableCSV(tableId, filename) {
        var table = document.getElementById(tableId);
        if (!table) return;

        var rows = table.querySelectorAll('tr');
        var csv  = [];

        for (var i = 0; i < rows.length; i++) {
            var cols = rows[i].querySelectorAll('th, td');
            var row  = [];
            for (var j = 0; j < cols.length; j++) {
                var text = cols[j].innerText.replace(/"/g, '""');
                row.push('"' + text + '"');
            }
            csv.push(row.join(','));
        }

        var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
        var url  = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }


    /* ==================================================================
       13. NOTIFICATIONS BUTTON
       ================================================================== */
    function initNotifications() {
        var btn = document.getElementById('btn-notifications');
        if (!btn) return;

        btn.addEventListener('click', function () {
            var alerts = GridGuardData.getRecentAlerts(3);
            var msg = 'Recent Alerts:\n\n';
            for (var i = 0; i < alerts.length; i++) {
                msg += '[' + alerts[i].severity.toUpperCase() + '] ' +
                       alerts[i].description + '\n' +
                       formatTime(alerts[i].timestamp) + '\n\n';
            }
            alert(msg);
        });
    }


    /* ==================================================================
       14. MASTER UPDATE LOOP  (drives all DOM refreshes)
       ================================================================== */
    function masterUpdate() {
        /* These run on every page that has the relevant DOM elements */
        if (page === 'overview') {
            updateOverviewKPIs();
            updateSystemStatus();
            updateAlertsTable();
            updateActivityFeed();
        }

        if (page === 'live-monitoring') {
            updateLiveMetrics();
        }

        if (page === 'devices') {
            updateDeviceSummaryCards();
            var status = document.getElementById('device-filter');
            var search = document.getElementById('device-search');
            renderDevicesTable(
                status ? status.value : 'all',
                search ? search.value : ''
            );
        }

        if (page === 'anomalies') {
            renderAnomaliesTable();
        }

        if (page === 'intrusion') {
            var filter = document.getElementById('log-severity-filter');
            renderIntrusionTable(filter ? filter.value : 'all');
        }

        if (page === 'analytics') {
            var agg = GridGuardData.getAggregates();
            setMetricValue('kpi-total-energy',    round1(agg.totalPower * 24 / 1000));
            setMetricValue('kpi-peak-demand',     round1(agg.totalPower * 1.15 / 1000));
        }

        /* Update all charts (if any exist on this page) */
        GridGuardCharts.update();
    }


    /* ==================================================================
       15. INITIALISATION
       ================================================================== */
    function init() {
        /* Start simulation engine */
        GridGuardSimulation.start();

        /* Initialise charts (only creates ones with matching canvas IDs) */
        GridGuardCharts.init();

        /* Page-specific setup */
        if (page === 'overview') {
            updateOverviewKPIs();
            updateSystemStatus();
            updateAlertsTable();
            updateActivityFeed();
        }

        if (page === 'live-monitoring') {
            updateLiveMetrics();
        }

        if (page === 'devices') {
            initDevicesPage();
        }

        if (page === 'anomalies') {
            initAnomaliesPage();
        }

        if (page === 'intrusion') {
            initIntrusionPage();
        }

        if (page === 'analytics') {
            initAnalyticsPage();
        }

        if (page === 'settings') {
            initSettingsPage();
        }

        /* Notifications (all pages) */
        initNotifications();

        /* View All buttons — link to relevant pages */
        var viewAlertsBtn = document.getElementById('btn-view-all-alerts');
        if (viewAlertsBtn) {
            viewAlertsBtn.addEventListener('click', function () {
                window.location.href = (page === 'overview' ? 'pages/' : '') + 'anomalies.html';
            });
        }

        var viewActivityBtn = document.getElementById('btn-view-all-activity');
        if (viewActivityBtn) {
            viewActivityBtn.addEventListener('click', function () {
                window.location.href = (page === 'overview' ? 'pages/' : '') + 'intrusion-logs.html';
            });
        }

        /* Master update interval — refresh DOM every 3 seconds */
        setInterval(masterUpdate, 3000);
    }

    /* Run init when DOM is ready */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
