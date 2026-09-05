/* ========================================================================
   GRIDGUARD AI — Authentication Module (auth.js)
   ========================================================================
   Local authentication for the GridGuard AI dashboard.

   Provides:
     • Login / logout
     • Session management (localStorage-based)
     • Page protection (redirects unauthenticated users to login)
     • Profile dropdown UI in the sidebar footer

   Demo credentials:
     Email:    admin@gridguard.ai
     Password: admin123

   These are also validated by the backend POST /api/login when the
   server is running.  When the backend is unreachable, client-side
   fallback validation is used so the dashboard remains functional.
   ======================================================================== */

var GridGuardAuth = (function () {
    'use strict';

    var SESSION_KEY   = 'gridguard_session_v1';
    var TIMEOUT_KEY   = 'gridguard_timeout_min';

    /* Demo credentials — used for client-side fallback when the
       backend is not reachable.  The backend validates the same
       credentials server-side (see backend/config.py). */
    var DEMO_USERS = {
        'admin@gridguard.ai': {
            password: 'admin123',
            name: 'Admin',
            email: 'admin@gridguard.ai',
            role: 'Administrator'
        }
    };

    /* ==================================================================
       1. SESSION MANAGEMENT
       ================================================================== */

    function _createSession(user) {
        return {
            token:    'gg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            user:     user.name,
            email:    user.email,
            role:     user.role || 'Operator',
            loginTime: Date.now()
        };
    }

    function _getSessionTimeout() {
        try {
            var state = localStorage.getItem('gridguard_state_v1');
            if (state) {
                var parsed = JSON.parse(state);
                if (parsed.settings && parsed.settings.sessionTimeout) {
                    return parseInt(parsed.settings.sessionTimeout, 10);
                }
            }
        } catch (e) { /* ignore */ }
        return 30; /* default: 30 minutes */
    }

    function login(username, password) {
        /* Try backend API first */
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/login', false); /* synchronous */
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ username: username, password: password }));

            if (xhr.status === 200) {
                var resp = JSON.parse(xhr.responseText);
                if (resp.ok && resp.user) {
                    localStorage.setItem(SESSION_KEY, JSON.stringify(_createSession(resp.user)));
                    return true;
                }
            }
            /* Backend returned an error — use its message */
            if (xhr.status === 200 || xhr.status >= 400) {
                try {
                    var errResp = JSON.parse(xhr.responseText);
                    if (errResp.error) return errResp.error;
                } catch (e) { /* ignore parse error */ }
            }
        } catch (e) {
            /* Backend unreachable — fall through to client-side check */
        }

        /* Client-side fallback */
        var key = username.toLowerCase().trim();
        var demoUser = DEMO_USERS[key];
        if (demoUser && demoUser.password === password) {
            localStorage.setItem(SESSION_KEY, JSON.stringify(_createSession(demoUser)));
            return true;
        }

        return 'Invalid email or password';
    }

    function logout() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    }

    function isAuthenticated() {
        try {
            var raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return false;

            var session = JSON.parse(raw);
            if (!session || !session.token || !session.loginTime) return false;

            /* Check session timeout */
            var timeoutMin = _getSessionTimeout();
            var elapsed = (Date.now() - session.loginTime) / 60000;
            if (elapsed > timeoutMin) {
                localStorage.removeItem(SESSION_KEY);
                return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    function getSession() {
        try {
            var raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            var session = JSON.parse(raw);

            /* Also check timeout */
            var timeoutMin = _getSessionTimeout();
            var elapsed = (Date.now() - session.loginTime) / 60000;
            if (elapsed > timeoutMin) {
                localStorage.removeItem(SESSION_KEY);
                return null;
            }

            return session;
        } catch (e) {
            return null;
        }
    }

    /* ==================================================================
       2. NAVIGATION HELPERS
       ================================================================== */

    function _loginPagePath() {
        var path = window.location.pathname;
        if (path.indexOf('/pages/') !== -1) return '../login.html';
        return 'login.html';
    }

    function _dashboardPath() {
        var path = window.location.pathname;
        if (path.indexOf('/pages/') !== -1) return '../index.html';
        return 'index.html';
    }

    function redirectToLogin() {
        window.location.href = _loginPagePath();
    }

    function redirectToDashboard() {
        window.location.href = _dashboardPath();
    }

    /* ==================================================================
       3. UI — update sidebar user area + profile dropdown
       ================================================================== */

    function _updateSidebarUser() {
        var el = document.getElementById('sidebar-user');
        if (!el) return;

        var session = getSession();
        var name  = session ? session.user  : 'Admin';
        var email = session ? session.email : 'admin@gridguard.ai';

        /* Update text content */
        var nameEl = el.querySelector('.gg-device-item__name');
        var metaEl = el.querySelector('.gg-device-item__meta');
        if (nameEl) nameEl.textContent = name;
        if (metaEl) metaEl.textContent = email;

        /* Make the footer area clickable */
        el.style.cursor = 'pointer';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', 'User menu');
        el.setAttribute('title', 'Click for account options');

        el.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            _toggleDropdown(el);
        });

        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _toggleDropdown(el);
            }
        });
    }

    function _toggleDropdown(anchorEl) {
        var existing = document.getElementById('gg-profile-dropdown');
        if (existing) { existing.remove(); return; }

        var session = getSession();
        var name    = session ? session.user  : 'Admin';
        var email   = session ? session.email : 'admin@gridguard.ai';
        var role    = session ? (session.role || 'Operator') : 'Administrator';

        var dropdown = document.createElement('div');
        dropdown.id = 'gg-profile-dropdown';
        dropdown.style.cssText =
            'position:fixed;bottom:60px;left:12px;width:236px;' +
            'background:var(--bg-surface-overlay);' +
            'border:1px solid var(--border-medium);' +
            'border-radius:var(--radius-lg);' +
            'box-shadow:var(--shadow-lg);' +
            'z-index:var(--z-dropdown);' +
            'padding:var(--space-3) 0;';

        dropdown.innerHTML =
            '<div style="padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-subtle);">' +
                '<div style="font-size:var(--text-base);font-weight:var(--font-semibold);color:var(--text-heading);">' + name + '</div>' +
                '<div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:2px;">' + email + '</div>' +
                '<div style="font-size:var(--text-xs);color:var(--accent-cyan);margin-top:4px;">' + role + '</div>' +
            '</div>' +
            '<div style="padding:var(--space-2) 0;">' +
                '<div id="gg-dropdown-logout" style="padding:var(--space-2) var(--space-4);cursor:pointer;display:flex;align-items:center;gap:var(--space-2);' +
                    'font-size:var(--text-sm);color:var(--status-critical);transition:background var(--transition-base);">' +
                    '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">' +
                        '<path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm5 4a1 1 0 00-2 0v4a1 1 0 002 0V7zm4 0a1 1 0 00-2 0v4a1 1 0 002 0V7z" clip-rule="evenodd"/>' +
                    '</svg>' +
                    'Sign Out' +
                '</div>' +
            '</div>';

        document.body.appendChild(dropdown);

        /* Logout handler */
        var logoutBtn = document.getElementById('gg-dropdown-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('mouseenter', function () {
                this.style.background = 'var(--bg-surface-hover)';
            });
            logoutBtn.addEventListener('mouseleave', function () {
                this.style.background = 'transparent';
            });
            logoutBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                logout();
                redirectToLogin();
            });
        }

        /* Close on outside click */
        function closeHandler(e) {
            if (!dropdown.contains(e.target) && !anchorEl.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeHandler);
            }
        }
        setTimeout(function () {
            document.addEventListener('click', closeHandler);
        }, 0);
    }

    /* ==================================================================
       4. HEADER PROFILE BUTTON
       ================================================================== */

    function _initHeaderProfile() {
        var btn = document.getElementById('btn-profile');
        if (!btn) return;

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var sidebarUser = document.getElementById('sidebar-user');
            _toggleDropdown(sidebarUser || btn);
        });
    }

    /* ==================================================================
       5. INIT
       ================================================================== */

    function initUI() {
        _updateSidebarUser();
        _initHeaderProfile();
    }

    function initAuth() {
        var isLoginPage = window.location.pathname.indexOf('login.html') !== -1;

        if (isLoginPage) {
            /* Already logged in → go to dashboard */
            if (isAuthenticated()) {
                redirectToDashboard();
            }
            return;
        }

        /* Protected page check */
        if (!isAuthenticated()) {
            redirectToLogin();
            return;
        }

        /* Authenticated — update the sidebar / header UI */
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initUI);
        } else {
            initUI();
        }
    }

    /* ==================================================================
       6. PUBLIC API
       ================================================================== */

    return {
        login:             login,
        logout:            logout,
        isAuthenticated:   isAuthenticated,
        getSession:        getSession,
        redirectToLogin:    redirectToLogin,
        redirectToDashboard: redirectToDashboard,
        initAuth:          initAuth,
        initUI:            initUI
    };

})();

/* Auto-initialise on script load */
GridGuardAuth.initAuth();


/* ======================================================================
   LOGIN PAGE HANDLER
   ====================================================================== */
(function () {
    'use strict';

    var isLoginPage = window.location.pathname.indexOf('login.html') !== -1;
    if (!isLoginPage) return;

    function showError(msg) {
        var el = document.getElementById('login-error');
        if (el) {
            el.textContent = msg;
            el.style.display = 'flex';
        }
    }

    function initLoginForm() {
        var form = document.getElementById('login-form');
        if (!form) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            /* Clear previous errors */
            var errEl = document.getElementById('login-error');
            if (errEl) errEl.style.display = 'none';

            var usernameInput = document.getElementById('login-username');
            var passwordInput = document.getElementById('login-password');
            var username = usernameInput ? usernameInput.value.trim() : '';
            var password = passwordInput ? passwordInput.value : '';

            if (!username || !password) {
                showError('Please enter both email and password.');
                return;
            }

            var result = GridGuardAuth.login(username, password);
            if (result === true) {
                /* Login succeeded — redirect to dashboard */
                window.location.href = 'index.html';
            } else {
                showError(typeof result === 'string' ? result : 'Invalid email or password.');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLoginForm);
    } else {
        initLoginForm();
    }
})();
