'use strict';

(function () {
  // ---------------------------------------------------------------------------
  // Constants & DOM references
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = 'rn-devtools-hosts';
  const ACTIVE_HOST_KEY = 'rn-devtools-active-host';
  const FETCH_TIMEOUT_MS = 10000;
  const REPLACEABLE_HOSTS = ['0.0.0.0', 'localhost', '127.0.0.1'];

  const hostListEl = document.getElementById('hostList');
  const targetsEl = document.getElementById('targets');
  const emptyStateEl = document.getElementById('emptyState');
  const toolbar = document.getElementById('toolbar');
  const toolbarHost = document.getElementById('toolbarHost');
  const targetCount = document.getElementById('targetCount');
  const addHostForm = document.getElementById('addHostForm');
  const hostInput = document.getElementById('hostInput');
  const refreshBtn = document.getElementById('refreshBtn');

  let hosts = [];
  let activeHost = null;
  let fetchController = null;
  let inputErrorTimer = null;
  const hostStatus = new Map(); // host → 'reachable' | 'error'

  // ---------------------------------------------------------------------------
  // Storage (chrome.storage.local)
  // ---------------------------------------------------------------------------

  async function loadState() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_HOST_KEY]);
      hosts = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      return data[ACTIVE_HOST_KEY] || null;
    } catch (e) {
      console.warn('Failed to load state:', e.message);
      hosts = [];
      return null;
    }
  }

  async function saveHosts() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: hosts });
    } catch (e) {
      console.warn('Failed to save hosts:', e.message);
    }
  }

  async function saveActiveHost() {
    try {
      await chrome.storage.local.set({ [ACTIVE_HOST_KEY]: activeHost });
    } catch (e) {
      console.warn('Failed to save active host:', e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isValidHost(str) {
    try {
      const url = new URL(`http://${str}`);
      return url.pathname === '/' && !url.search && !url.hash &&
             url.username === '' && url.password === '';
    } catch (e) {
      return false;
    }
  }

  function replaceLoopback(parsed, hostname) {
    if (REPLACEABLE_HOSTS.includes(parsed.hostname)) {
      parsed.hostname = hostname;
    }
  }

  function showInputError(msg) {
    let el = document.getElementById('hostError');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hostError';
      el.className = 'input-error';
      el.setAttribute('role', 'alert');
      addHostForm.parentNode.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(inputErrorTimer);
    inputErrorTimer = setTimeout(function () { el.textContent = ''; }, 3000);
  }

  function findHostEl(host) {
    return hostListEl.querySelector(`[data-host="${CSS.escape(host)}"]`);
  }

  // ---------------------------------------------------------------------------
  // Hosts
  // ---------------------------------------------------------------------------

  function addHost(raw) {
    let host = raw.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) return;
    if (/^https?:\/\//i.test(host)) {
      showInputError('Invalid host address');
      return;
    }
    if (!host.includes(':')) host += ':8081';
    if (!isValidHost(host)) {
      showInputError('Invalid host address');
      return;
    }
    if (hosts.includes(host)) {
      selectHost(host);
      return;
    }
    hosts.push(host);
    saveHosts();
    renderHosts();
    selectHost(host);
  }

  function removeHost(host) {
    hosts = hosts.filter(function (h) { return h !== host; });
    hostStatus.delete(host);
    saveHosts();
    if (activeHost === host) {
      activeHost = null;
      saveActiveHost();
      showEmpty();
    }
    renderHosts();
  }

  function renderHosts() {
    hostListEl.replaceChildren();
    hosts.forEach(function (host) {
      const el = document.createElement('div');
      el.className = `host-item${host === activeHost ? ' active' : ''}`;
      el.setAttribute('role', 'listitem');
      el.setAttribute('data-host', host);
      el.addEventListener('click', function () { selectHost(host); });

      const status = hostStatus.get(host);
      if (status) el.classList.add(status);

      const dot = document.createElement('span');
      dot.className = 'status';
      dot.setAttribute('aria-hidden', 'true');

      const statusText = status === 'reachable' ? 'reachable' : status === 'error' ? 'unreachable' : '';
      const label = document.createElement('span');
      label.className = 'label';
      label.title = host;
      label.textContent = host;
      label.tabIndex = 0;
      label.setAttribute('role', 'button');
      label.setAttribute('aria-label', statusText ? `${host} (${statusText})` : host);
      label.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectHost(host);
        }
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.title = 'Remove';
      remove.textContent = '\u00d7';
      remove.setAttribute('aria-label', `Remove ${host}`);
      remove.addEventListener('click', function (e) {
        e.stopPropagation();
        removeHost(host);
      });

      el.append(dot, label, remove);
      hostListEl.appendChild(el);
    });
  }

  // ---------------------------------------------------------------------------
  // Targets
  // ---------------------------------------------------------------------------

  function showEmpty() {
    toolbar.classList.add('hidden');
    targetsEl.replaceChildren(emptyStateEl);
    emptyStateEl.classList.remove('hidden');
  }

  function selectHost(host) {
    activeHost = host;
    saveActiveHost();
    renderHosts();
    fetchTargets(host);
  }

  async function fetchTargets(host) {
    if (fetchController) fetchController.abort();
    const controller = new AbortController();
    fetchController = controller;
    const timeoutId = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

    toolbar.classList.remove('hidden');
    toolbarHost.textContent = host;
    targetCount.textContent = '';

    const spinnerWrap = document.createElement('div');
    spinnerWrap.className = 'loading';
    spinnerWrap.setAttribute('role', 'status');
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    const loadingText = document.createElement('span');
    loadingText.className = 'visually-hidden';
    loadingText.textContent = 'Loading debug targets\u2026';
    spinnerWrap.append(spinner, loadingText);
    targetsEl.replaceChildren(spinnerWrap);

    try {
      const url = new URL('/json', `http://${host}`);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      let data;
      try {
        data = await resp.json();
      } catch (e) {
        throw new Error('Invalid response from Metro server');
      }

      if (controller !== fetchController) return;
      fetchController = null;
      hostStatus.set(host, 'reachable');

      const hostEl = findHostEl(host);
      if (hostEl) {
        hostEl.classList.add('reachable');
        hostEl.classList.remove('error');
      }

      renderTargets(host, data);
    } catch (err) {
      clearTimeout(timeoutId);
      if (controller !== fetchController) return;
      fetchController = null;
      hostStatus.set(host, 'error');

      const hostEl = findHostEl(host);
      if (hostEl) {
        hostEl.classList.add('error');
        hostEl.classList.remove('reachable');
      }

      const message = err.name === 'AbortError' ? 'Request timed out' : err.message;

      const banner = document.createElement('div');
      banner.className = 'error-banner';
      banner.setAttribute('role', 'alert');

      const strong = document.createElement('strong');
      strong.textContent = `http://${host}/json`;

      const detail = document.createElement('span');
      detail.className = 'error-detail';
      detail.textContent = message;

      banner.append('Failed to fetch ', strong, document.createElement('br'), detail);
      targetsEl.replaceChildren(banner);
    }
  }

  function buildDevtoolsUrl(host, target) {
    const hostname = new URL(`http://${host}`).hostname;
    let wsParam = '';
    let secure = false;

    if (target.webSocketDebuggerUrl) {
      try {
        const parsed = new URL(target.webSocketDebuggerUrl);
        secure = parsed.protocol === 'wss:';
        replaceLoopback(parsed, hostname);
        wsParam = `${parsed.host}${parsed.pathname}${parsed.search}`;
      } catch (e) {
        wsParam = target.webSocketDebuggerUrl.replace(/^wss?:\/\//, '');
      }
    } else if (target.devtoolsFrontendUrl) {
      const match = target.devtoolsFrontendUrl.match(/[?&](wss?)=([^&]+)/);
      if (match) {
        secure = match[1] === 'wss';
        try {
          const raw = decodeURIComponent(match[2]);
          const parsed = new URL(`ws://${raw}`);
          replaceLoopback(parsed, hostname);
          wsParam = `${parsed.host}${parsed.pathname}${parsed.search}`;
        } catch (e) {
          wsParam = decodeURIComponent(match[2]);
        }
      }
    }

    if (!wsParam) return null;

    const paramName = secure ? 'wss' : 'ws';
    const query = `?${paramName}=${encodeURIComponent(wsParam)}`;
    return {
      extension: chrome.runtime.getURL('devtools/rn_fusebox.html') + query,
      metro: `http://${host}/debugger-frontend/rn_fusebox.html${query}`,
    };
  }

  function renderTargets(host, targets) {
    if (!Array.isArray(targets) || targets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No debug targets found on this host.';
      targetsEl.replaceChildren(empty);
      targetCount.textContent = '(0 targets)';
      return;
    }

    targetCount.textContent = `(${targets.length} target${targets.length !== 1 ? 's' : ''})`;
    targetsEl.replaceChildren();

    targets.forEach(function (target) {
      if (!target || typeof target !== 'object') return;

      const devtoolsUrls = buildDevtoolsUrl(host, target);
      const card = document.createElement('div');
      card.className = 'target-card';

      const title = String(target.title || target.description || 'Untitled');
      const pageUrl = String(target.url || '');
      const type = String(target.type || 'unknown');
      const deviceId = String(target.id || '');

      const titleEl = document.createElement('div');
      titleEl.className = 'target-title';
      titleEl.textContent = title;

      const urlEl = document.createElement('div');
      urlEl.className = 'target-url';
      urlEl.textContent = pageUrl;

      const meta = document.createElement('div');
      meta.className = 'target-meta';

      const typeBadge = document.createElement('span');
      typeBadge.className = 'badge';
      typeBadge.textContent = type;
      meta.appendChild(typeBadge);

      if (deviceId) {
        const idBadge = document.createElement('span');
        idBadge.className = 'badge';
        idBadge.textContent = `id: ${deviceId.slice(0, 12)}`;
        meta.appendChild(idBadge);
      }

      if (devtoolsUrls) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copy Metro-served devtools URL';
        copyBtn.textContent = 'Copy URL';
        copyBtn.addEventListener('click', async function (e) {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(devtoolsUrls.metro);
            copyBtn.textContent = 'Copied!';
          } catch (err) {
            copyBtn.textContent = 'Failed';
          }
          setTimeout(function () { copyBtn.textContent = 'Copy URL'; }, 1500);
        });

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'open-btn';
        openBtn.textContent = 'Open DevTools';
        openBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          chrome.tabs.create({ url: devtoolsUrls.extension });
        });

        meta.append(copyBtn, openBtn);
      } else {
        const noUrl = document.createElement('span');
        noUrl.className = 'badge';
        noUrl.textContent = 'no debug URL';
        meta.appendChild(noUrl);
      }

      card.append(titleEl, urlEl, meta);
      targetsEl.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  addHostForm.addEventListener('submit', function (e) {
    e.preventDefault();
    addHost(hostInput.value);
    hostInput.value = '';
  });

  refreshBtn.addEventListener('click', function () {
    if (activeHost) fetchTargets(activeHost);
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async function init() {
    const savedActive = await loadState();
    renderHosts();
    if (savedActive && hosts.includes(savedActive)) {
      selectHost(savedActive);
    } else {
      showEmpty();
    }
  }

  init();
})();
