const API_BASE = '';
let allNodes = [];
let deployCommands = [];
let masterUrl = 'http://YOUR_MASTER_IP:8080/smokeping/smokeping.fcgi.dist';
let sharedSecret = '';
let currentRange = '3h';
let currentIsp = 'CT';
let currentCity = 'shenzhen';
let authToken = null;
let activeTab = 'nodes';

const TARGET_MAP = {
  'CT': {
    'shenzhen': 'CT.ct_shenzhen',
    'shanghai': 'CT.ct_shanghai',
    'beijing': 'CT.ct_beijing',
  },
  'CU': {
    'shenzhen': 'CU.cu_shenzhen',
    'shanghai': 'CU.cu_shanghai',
    'beijing': 'CU.cu_beijing',
  },
  'CM': {
    'shenzhen': 'CM.cm_shenzhen',
    'shanghai': 'CM.cm_shanghai',
    'beijing': 'CM.cm_beijing',
  },
};

const TIME_SECONDS = { '3h': 10800, '30h': 108000, '10d': 864000, '360d': 31104000 };

function getTargetId() {
  return TARGET_MAP[currentIsp]?.[currentCity] || 'CT.ct_shenzhen';
}

async function fetchNodes() {
  try {
    const res = await fetch(`${API_BASE}/api/nodes`);
    const data = await res.json();
    return data.nodes || [];
  } catch (err) {
    console.error('Failed to fetch nodes:', err);
    return [];
  }
}

async function fetchDeploy() {
  try {
    const res = await fetch(`${API_BASE}/api/deploy`);
    const data = await res.json();
    masterUrl = data.master_url || masterUrl;
    sharedSecret = data.shared_secret || '';
    return data.commands || [];
  } catch (err) {
    return [];
  }
}

async function fetchConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const data = await res.json();
    masterUrl = data.master_url || masterUrl;
    return data;
  } catch (err) {
    return {};
  }
}

async function apiAuth(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (res.status === 401) {
    authToken = null;
    showAuthPrompt();
    throw new Error('Unauthorized');
  }
  return data;
}

async function doLogin(password) {
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (data.success) {
    authToken = data.token;
    return true;
  }
  return false;
}

async function addNode(name, host) {
  return apiAuth('POST', '/api/nodes', { name, host });
}

async function deleteNode(id) {
  return apiAuth('DELETE', `/api/nodes/${id}`);
}

async function saveMasterUrl(url) {
  return apiAuth('POST', '/api/config', { master_url: url });
}

async function changePassword(oldPassword, newPassword) {
  return apiAuth('POST', '/api/settings', { key: 'admin_password', value: newPassword, oldPassword });
}

function renderStats() {
  document.getElementById('totalNodes').textContent = allNodes.length;
  document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
}

function createNodeCard(node) {
  const card = document.createElement('div');
  card.className = 'node-card';
  card.dataset.slave = node.slaveName;

  const target = getTargetId();
  const parts = target.split('.');
  const section = parts[0];
  const targetId = parts[1];
  const seconds = TIME_SECONDS[currentRange] || 10800;
  const imgUrl = `/api/cache/${section}/${targetId}~${node.slaveName}_last_${seconds}.png?_=${Date.now()}`;

  card.innerHTML = `
    <div class="node-card-header">
      <span class="node-name">${escapeHtml(node.name)}</span>
      <span class="node-host">${escapeHtml(node.host)}</span>
    </div>
    <div class="node-chart">
      <img src="${imgUrl}" alt="Chart">
    </div>
  `;

  return card;
}

function renderNodes() {
  const grid = document.getElementById('nodesGrid');

  if (allNodes.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>No nodes configured. Click <strong>Manage</strong> to add your first node.</p></div>';
    return;
  }

  grid.innerHTML = '';
  allNodes.forEach(node => {
    grid.appendChild(createNodeCard(node));
  });
}

function showAuthPrompt() {
  document.getElementById('modalTitle').textContent = 'Admin Access';
  const body = document.getElementById('modalBody');
  body.innerHTML = `
    <div class="auth-form">
      <p class="auth-hint">Enter admin password to manage nodes and settings.</p>
      <div class="form-group">
        <input type="password" id="authPassword" placeholder="Password" autofocus>
      </div>
      <div class="form-error" id="authError"></div>
      <button class="btn-primary btn-full" id="authSubmit">Login</button>
    </div>
    <p class="auth-footer">Default password: <code>admin123</code> — change it after first login.</p>
  `;

  document.getElementById('authSubmit').addEventListener('click', async () => {
    const pw = document.getElementById('authPassword').value;
    const err = document.getElementById('authError');
    if (!pw) { err.textContent = 'Password is required'; return; }
    const ok = await doLogin(pw);
    if (ok) {
      err.textContent = '';
      showManagePanel();
    } else {
      err.textContent = 'Invalid password';
    }
  });

  document.getElementById('authPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('authSubmit').click();
  });

  document.getElementById('modalOverlay').classList.add('active');
}

function showManagePanel() {
  document.getElementById('modalTitle').textContent = 'Manage SmokeDash';
  const body = document.getElementById('modalBody');
  renderManageBody(body);
  document.getElementById('modalOverlay').classList.add('active');
}

function renderManageBody(body) {
  body.innerHTML = `
    <div class="manage-tabs">
      <button class="manage-tab ${activeTab === 'nodes' ? 'active' : ''}" data-tab="nodes">Nodes</button>
      <button class="manage-tab ${activeTab === 'deploy' ? 'active' : ''}" data-tab="deploy">Deploy</button>
      <button class="manage-tab ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
    </div>
    <div class="manage-content" id="manageContent"></div>
  `;

  body.querySelectorAll('.manage-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderManageBody(body);
    });
  });

  const content = document.getElementById('manageContent');
  if (activeTab === 'nodes') renderNodesTab(content);
  else if (activeTab === 'deploy') renderDeployTab(content);
  else if (activeTab === 'settings') renderSettingsTab(content);
}

function renderNodesTab(content) {
  let nodesHtml = '';
  allNodes.forEach(node => {
    nodesHtml += `
      <div class="manage-node-item">
        <div class="manage-node-info">
          <span class="manage-node-name">${escapeHtml(node.name)}</span>
          <span class="manage-node-host">${escapeHtml(node.host)}</span>
          <span class="manage-node-slave">slave: ${escapeHtml(node.slaveName)}</span>
        </div>
        <button class="btn-danger btn-sm" data-delete="${node.id}">Delete</button>
      </div>
    `;
  });

  if (!nodesHtml) nodesHtml = '<p class="empty-hint">No nodes yet. Add one below.</p>';

  content.innerHTML = `
    <div class="manage-section">
      <h3>Add Node</h3>
      <div class="add-node-form">
        <input type="text" id="newNodeName" placeholder="Display Name">
        <input type="text" id="newNodeHost" placeholder="IP or Domain">
        <button class="btn-primary" id="addNodeBtn">Add</button>
      </div>
      <div class="form-error" id="addNodeError"></div>
    </div>
    <div class="manage-section">
      <h3>All Nodes (${allNodes.length})</h3>
      <div class="manage-node-list">${nodesHtml}</div>
    </div>
  `;

  document.getElementById('addNodeBtn').addEventListener('click', async () => {
    const name = document.getElementById('newNodeName').value.trim();
    const host = document.getElementById('newNodeHost').value.trim();
    const err = document.getElementById('addNodeError');
    if (!name || !host) { err.textContent = 'Name and host are required'; return; }
    err.textContent = '';
    try {
      await addNode(name, host);
      await refreshAll();
      renderManageBody(document.getElementById('modalBody'));
    } catch (e) {
      err.textContent = e.message;
    }
  });

  content.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this node? This will remove it from monitoring.')) return;
      await deleteNode(parseInt(btn.dataset.delete));
      await refreshAll();
      renderManageBody(document.getElementById('modalBody'));
    });
  });
}

function renderDeployTab(content) {
  let commandsHtml = '';
  deployCommands.forEach(cmd => {
    commandsHtml += `
      <div class="deploy-item">
        <div class="deploy-header">
          <span class="deploy-name">${escapeHtml(cmd.name)}</span>
          <span class="deploy-slave">${escapeHtml(cmd.slave_name)}</span>
          <button class="copy-btn" data-cmd="${escapeHtml(cmd.command)}">Copy</button>
        </div>
        <pre class="deploy-cmd">${escapeHtml(cmd.command)}</pre>
      </div>
    `;
  });

  content.innerHTML = `
    <div class="manage-section">
      <h3>Slave Deployment Commands</h3>
      <p class="form-hint">Run each command on the corresponding node server to deploy a SmokePing slave.</p>
      <div class="deploy-url-section">
        <label for="deployMasterUrl">Master Server URL</label>
        <div class="url-input-group">
          <input type="text" id="deployMasterUrl" value="${escapeHtml(masterUrl)}" placeholder="http://your-server-ip:8080/smokeping/smokeping.fcgi.dist">
          <button class="btn-primary" id="saveMasterUrlBtn">Save</button>
        </div>
      </div>
      <div class="deploy-secret">
        <label>Shared Secret</label>
        <div class="secret-display">
          <code>${escapeHtml(sharedSecret)}</code>
          <button class="btn-sm" id="copySecretBtn">Copy</button>
        </div>
      </div>
    </div>
    <div class="manage-section">
      <div class="deploy-list">
        ${commandsHtml || '<p class="empty-hint">No nodes configured yet. Add nodes first.</p>'}
      </div>
    </div>
  `;

  document.getElementById('saveMasterUrlBtn').addEventListener('click', async () => {
    const url = document.getElementById('deployMasterUrl').value.trim();
    if (url) {
      await saveMasterUrl(url);
      masterUrl = url;
      await fetchDeploy();
      renderManageBody(document.getElementById('modalBody'));
    }
  });

  document.getElementById('copySecretBtn').addEventListener('click', () => {
    copyToClipboard(sharedSecret);
    const btn = document.getElementById('copySecretBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });

  content.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.dataset.cmd);
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });
  });
}

function renderSettingsTab(content) {
  content.innerHTML = `
    <div class="manage-section">
      <h3>Change Admin Password</h3>
      <div class="settings-form">
        <div class="form-group">
          <label for="oldPassword">Current Password</label>
          <input type="password" id="oldPassword" placeholder="Current password">
        </div>
        <div class="form-group">
          <label for="newPassword">New Password</label>
          <input type="password" id="newPassword" placeholder="New password">
        </div>
        <div class="form-error" id="pwdError"></div>
        <button class="btn-primary" id="changePwdBtn">Change Password</button>
      </div>
      <div class="form-success" id="pwdSuccess"></div>
    </div>
    <div class="manage-section">
      <h3>Session</h3>
      <button class="btn-danger" id="logoutBtn">Logout</button>
    </div>
  `;

  document.getElementById('changePwdBtn').addEventListener('click', async () => {
    const oldPw = document.getElementById('oldPassword').value;
    const newPw = document.getElementById('newPassword').value;
    const err = document.getElementById('pwdError');
    const ok = document.getElementById('pwdSuccess');
    err.textContent = '';
    ok.textContent = '';
    if (!newPw || newPw.length < 4) {
      err.textContent = 'New password must be at least 4 characters';
      return;
    }
    try {
      await changePassword(oldPw, newPw);
      ok.textContent = 'Password changed successfully!';
    } catch (e) {
      err.textContent = e.message;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
      });
    } catch (e) {}
    authToken = null;
    closeModal();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyToClipboard(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  document.body.removeChild(ta);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  activeTab = 'nodes';
}

async function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  await fetchConfig();
  try {
    const syncRes = await fetch(`${API_BASE}/api/sync`, { method: 'POST' });
    if (syncRes.ok) {
      const data = await syncRes.json();
      allNodes = data.nodes || [];
      deployCommands = data.commands || [];
    } else {
      allNodes = await fetchNodes();
      deployCommands = await fetchDeploy();
    }
  } catch {
    allNodes = await fetchNodes();
    deployCommands = await fetchDeploy();
  }

  renderStats();
  renderNodes();

  setTimeout(() => btn.classList.remove('spinning'), 1000);
}

function setFilter(type, value) {
  if (type === 'isp') {
    currentIsp = value;
    document.querySelectorAll('.isp-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.isp-btn[data-isp="${value}"]`).classList.add('active');
  } else if (type === 'city') {
    currentCity = value;
    document.querySelectorAll('.city-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.city-btn[data-city="${value}"]`).classList.add('active');
  } else if (type === 'range') {
    currentRange = value;
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.range-btn[data-range="${value}"]`).classList.add('active');
  }
  renderNodes();
}

document.querySelectorAll('.isp-btn').forEach(btn => {
  btn.addEventListener('click', () => setFilter('isp', btn.dataset.isp));
});

document.querySelectorAll('.city-btn').forEach(btn => {
  btn.addEventListener('click', () => setFilter('city', btn.dataset.city));
});

document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => setFilter('range', btn.dataset.range));
});

document.getElementById('refreshBtn').addEventListener('click', refreshAll);
document.getElementById('deployBtn').addEventListener('click', () => {
  if (authToken) {
    showManagePanel();
  } else {
    showAuthPrompt();
  }
});
document.getElementById('filterToggle').addEventListener('click', () => {
  const filters = document.getElementById('headerFilters');
  const toggle = document.getElementById('filterToggle');
  filters.classList.toggle('open');
  toggle.classList.toggle('active');
});
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

refreshAll();
