const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');
const Database = require('better-sqlite3');
const cron = require('node-cron');

const app = express();
const PORT = 3000;
const SMOKEPING_URL = process.env.SMOKEPING_URL || 'http://smokeping:80';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(__dirname, 'config.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'smokedash.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function dbGetSetting(key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function dbSetSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

const envPassword = process.env.ADMIN_PASSWORD;
if (envPassword) {
  const dbPass = dbGetSetting('admin_password', '');
  if (envPassword !== dbPass) {
    dbSetSetting('admin_password', envPassword);
    console.log('Admin password reset via ADMIN_PASSWORD env');
  }
}

if (!dbGetSetting('admin_password')) {
  dbSetSetting('admin_password', 'admin123');
  console.log('Default admin password set: admin123');
}

const authTokens = new Map();
const TOKEN_TTL = 3600000;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [token, expires] of authTokens) {
    if (expires < now) authTokens.delete(token);
  }
}
setInterval(cleanExpiredTokens, 300000);

const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');

const ISP_TARGETS = [
  { section: 'CT', menu: 'CT', title: 'China Telecom', targets: [
    { id: 'ct_shenzhen', name: 'Shenzhen CT', host: '183.47.102.91' },
    { id: 'ct_shanghai', name: 'Shanghai CT', host: '202.96.209.133' },
    { id: 'ct_beijing', name: 'Beijing CT', host: '106.37.67.1' }
  ]},
  { section: 'CU', menu: 'CU', title: 'China Unicom', targets: [
    { id: 'cu_shenzhen', name: 'Shenzhen CU', host: '210.21.196.6' },
    { id: 'cu_shanghai', name: 'Shanghai CU', host: '210.22.97.1' },
    { id: 'cu_beijing', name: 'Beijing CU', host: '202.106.50.1' }
  ]},
  { section: 'CM', menu: 'CM', title: 'China Mobile', targets: [
    { id: 'cm_shenzhen', name: 'Shenzhen CM', host: '120.196.165.24' },
    { id: 'cm_shanghai', name: 'Shanghai CM', host: '211.136.112.200' },
    { id: 'cm_beijing', name: 'Beijing CM', host: '221.179.155.161' }
  ]}
];

const SMOKEPING_CONFIG_DIR = path.join(__dirname, 'smokeping_config');

let appConfig = {
  master_url: 'http://YOUR_MASTER_IP:8080/smokeping/smokeping.fcgi.dist'
};

let allNodes = [];
let deployCommands = [];

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (saved.master_url) appConfig.master_url = saved.master_url;
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function saveConfig(config) {
  appConfig = config;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ master_url: config.master_url }, null, 2));
}

function getNodesFromDB() {
  return db.prepare('SELECT id, name, secret FROM nodes ORDER BY id').all();
}

function generateConfig(nodes) {
  const slaveList = nodes.map((node) => {
    const slaveName = 'N' + node.id;
    return [slaveName, node];
  });

  const allSlaveNames = slaveList.map(([name]) => name).join(' ');

  let config = `*** General ***
owner    = SmokeDash
contact  = admin@localhost
mailhost = localhost
imgcache = /usr/local/smokeping/cache
imgurl   = cache
datadir  = /usr/local/smokeping/data
piddir   = /usr/local/smokeping/var
cgiurl   = http://localhost/smokeping/smokeping.fcgi.dist
smokemail = /usr/local/smokeping/etc/smokemail.dist
tmail    = /usr/local/smokeping/etc/tmail.dist
syslogfacility = smokeping

*** Alerts ***
to = admin@localhost
from = smokealert@localhost
+someloss
type = loss
pattern = >0%,*12*,>0%,*12*,>0%
comment = loss 3 times in a row

*** Database ***
step     = 60
pings    = 20
AVERAGE  0.5   1  1008
AVERAGE  0.5  12  4320
    MIN  0.5  12  4320
    MAX  0.5  12  4320
AVERAGE  0.5 144   720
    MAX  0.5 144   720
    MIN  0.5 144   720

*** Presentation ***
template = /usr/local/smokeping/etc/basepage.html.dist
charset  = utf-8

+ overview

width = 500
height = 50
range = 10h

+ detail

width = 500
height = 170
unison_tolerance = 2

"Last 3 Hours"    3h
"Last 30 Hours"   30h
"Last 10 Days"    10d
"Last 360 Days"   360d

*** Slaves ***
secrets=/usr/local/smokeping/etc/smokeping_secrets.dist

`;

  if (slaveList.length > 0) {
    for (const [slaveName, node] of slaveList) {
      config += `+${slaveName}\ndisplay_name=${node.name}\ncolor=ff6600\n\n`;
    }
  }

  config += `*** Probes ***
+ FPing
binary = /usr/bin/fping

*** Targets ***
probe = FPing
menu = Top
title = SmokeDash Node Latency Monitor
remark = Node-to-ISP latency monitoring

`;

  for (const isp of ISP_TARGETS) {
    config += `+ ${isp.section}\n`;
    config += `menu = ${isp.menu}\n`;
    config += `title = ${isp.title}\n`;
    if (allSlaveNames) {
      config += `slaves = ${allSlaveNames}\n`;
    }
    config += `nomasterpoll=yes\n\n`;
    for (const target of isp.targets) {
      config += `++ ${target.id}\n`;
      config += `menu = ${target.name}\n`;
      config += `title = ${target.name}\n`;
      config += `host = ${target.host}\n\n`;
    }
  }

  return { config, slaveList };
}

function generateSecrets(slaveList) {
  return slaveList.map(([name, node]) => `${name}:${node.secret}`).join('\n') + '\n';
}

function generateDeployCommands(slaveList) {
  return slaveList.map(([slaveName, node]) => ({
    slave_name: slaveName,
    name: node.name,
    command: `# ${node.name}\ndocker run -itd \\\n  --name smokeping-slave-${slaveName.toLowerCase()} \\\n  --network host \\\n  --restart=always \\\n  -e SMOKEPING_MASTER_URL="${appConfig.master_url}" \\\n  -e SMOKEPING_SHARED_SECRET="${node.secret}" \\\n  -e SMOKEPING_SLAVE_NAME="${slaveName}" \\\n  asdjkm1234/smokeping-slave:latest`
  }));
}

async function syncConfig() {
  console.log(`[${new Date().toISOString()}] Syncing config from database...`);

  try {
    const nodes = getNodesFromDB();
    const { config, slaveList } = generateConfig(nodes);
    const secrets = generateSecrets(slaveList);
    const commands = generateDeployCommands(slaveList);

    fs.mkdirSync(SMOKEPING_CONFIG_DIR, { recursive: true });

    const configPath = path.join(SMOKEPING_CONFIG_DIR, 'config');
    const secretsPath = path.join(SMOKEPING_CONFIG_DIR, 'smokeping_secrets.dist');

    const oldConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';

    if (config !== oldConfig) {
      fs.writeFileSync(configPath, config);
      fs.writeFileSync(secretsPath, secrets);
      fs.chmodSync(secretsPath, 0o600);
      console.log('Config changed! Auto-restarting smokeping...');
      try {
        const { execSync } = require('child_process');
        execSync('docker restart smokeping-master', { timeout: 30000 });
        console.log('SmokePing restarted successfully');
      } catch (err) {
        console.error('Failed to restart smokeping:', err.message);
      }
    } else {
      console.log('Config unchanged');
    }

    allNodes = slaveList.map(([slaveName, node]) => ({
      slaveName,
      id: node.id,
      name: node.name,
      secret: node.secret
    }));
    deployCommands = commands;

    console.log(`Sync complete: ${slaveList.length} nodes configured`);
  } catch (err) {
    console.error('Sync failed:', err);
  }
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const expires = authTokens.get(token);
  if (!expires || expires < Date.now()) {
    authTokens.delete(token);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.authToken = token;
  next();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  const storedPassword = dbGetSetting('admin_password', 'admin123');
  if (password === storedPassword) {
    const token = generateToken();
    authTokens.set(token, Date.now() + TOKEN_TTL);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  authTokens.delete(req.authToken);
  res.json({ success: true });
});

app.get('/api/nodes', (req, res) => {
  res.json({ success: true, nodes: allNodes });
});

app.post('/api/nodes', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const secret = crypto.randomBytes(24).toString('base64url').slice(0, 32);
    const result = db.prepare('INSERT INTO nodes (name, secret) VALUES (?, ?)').run(name.trim(), secret);
    syncConfig();
    setTimeout(() => prefetchCache(), 5000);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'This name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/nodes/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Node not found' });
  }
  syncConfig();
  res.json({ success: true });
});

app.get('/api/config', (req, res) => {
  res.json({ master_url: appConfig.master_url });
});

app.post('/api/config', requireAuth, (req, res) => {
  const { master_url } = req.body;
  const newConfig = { master_url: master_url || appConfig.master_url };
  saveConfig(newConfig);
  syncConfig();
  res.json({ success: true, config: newConfig });
});

app.post('/api/settings', requireAuth, (req, res) => {
  const { key, value, oldPassword } = req.body;
  if (key === 'admin_password') {
    const currentPassword = dbGetSetting('admin_password', 'admin123');
    if (oldPassword && oldPassword !== currentPassword) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    dbSetSetting('admin_password', value);
    return res.json({ success: true });
  }
  res.status(400).json({ error: 'Invalid setting key' });
});

app.post('/api/sync', async (req, res) => {
  try {
    await syncConfig();
    setTimeout(() => prefetchCache(), 5000);
    res.json({ success: true, nodes: allNodes, commands: deployCommands });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/deploy', (req, res) => {
  res.json({
    master_url: appConfig.master_url,
    commands: deployCommands
  });
});

const TIME_SECONDS = {
  '3h': 10800,
  '30h': 108000,
  '10d': 864000,
  '360d': 31104000,
};

app.get('/api/cache/:section/:filename', async (req, res) => {
  const { section, filename } = req.params;
  const cachePath = `/smokeping/cache/${section}/${filename}`;
  const spUrl = new URL(SMOKEPING_URL);

  const fetchCache = () => new Promise((resolve) => {
    const getReq = http.request({
      hostname: spUrl.hostname,
      port: spUrl.port || 80,
      path: cachePath,
      method: 'GET',
      timeout: 10000,
      headers: { 'User-Agent': 'SmokeDash/1.0' }
    }, (getRes) => {
      const chunks = [];
      getRes.on('data', chunk => chunks.push(chunk));
      getRes.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (getRes.statusCode === 200 && buffer.length > 100) {
          resolve(buffer);
        } else {
          resolve(null);
        }
      });
    });
    getReq.on('error', () => resolve(null));
    getReq.on('timeout', () => { getReq.destroy(); resolve(null); });
    getReq.end();
  });

  let buffer = await fetchCache();
  if (!buffer) {
    const match = filename.match(/^(.+?)~(.+)_last_\d+\.png$/);
    if (match) {
      const [, targetId, slave] = match;
      const cgiParams = new URLSearchParams({
        target: `${section}.${targetId}`,
        slave: slave,
        displaymode: 'noredraw'
      });
      const cgiPath = `/smokeping/smokeping.fcgi.dist?${cgiParams.toString()}`;
      await new Promise((resolve) => {
        const cgiReq = http.request({
          hostname: spUrl.hostname,
          port: spUrl.port || 80,
          path: cgiPath,
          method: 'HEAD',
          timeout: 15000
        }, (cgiRes) => { cgiRes.resume(); cgiRes.on('end', resolve); });
        cgiReq.on('error', () => resolve());
        cgiReq.on('timeout', () => { cgiReq.destroy(); resolve(); });
        cgiReq.end();
      });
    }
    await new Promise(r => setTimeout(r, 2000));
    buffer = await fetchCache();
  }

  if (buffer) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(buffer);
  } else {
    res.set('Content-Type', 'image/png');
    res.send(TRANSPARENT_PNG);
  }
});

function prefetchCache() {
  const spUrl = new URL(SMOKEPING_URL);

  const cacheDirs = ['CT', 'CU', 'CM'];
  for (const dir of cacheDirs) {
    const dirPath = path.join(__dirname, 'smokeping_cache', dir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith('.png')) {
          fs.unlinkSync(path.join(dirPath, file));
        }
      }
    }
  }

  for (const isp of ISP_TARGETS) {
    for (const target of isp.targets) {
      const cgiParams = new URLSearchParams({
        target: `${isp.section}.${target.id}`
      });
      const cgiPath = `/smokeping/smokeping.fcgi.dist?${cgiParams.toString()}`;

      const req = http.request({
        hostname: spUrl.hostname,
        port: spUrl.port || 80,
        path: cgiPath,
        method: 'GET',
        timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {});
      });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
      req.end();
    }
  }
  console.log(`[${new Date().toISOString()}] Cache refreshed for 9 targets`);
}

app.get('/api/overview', async (req, res) => {
  const spUrl = new URL(SMOKEPING_URL);
  const params = new URLSearchParams();
  params.set('target', req.query.target || '_root');
  params.set('displaymode', 'noredraw');

  const cgiPath = `/smokeping/smokeping.fcgi.dist?${params.toString()}`;

  const headOptions = {
    hostname: spUrl.hostname,
    port: spUrl.port || 80,
    path: cgiPath,
    method: 'HEAD',
    timeout: 15000
  };

  try {
    await new Promise((resolve, reject) => {
      const headReq = http.request(headOptions, (headRes) => {
        headRes.resume();
        headRes.on('end', resolve);
      });
      headReq.on('error', reject);
      headReq.on('timeout', () => { headReq.destroy(); reject(new Error('timeout')); });
      headReq.end();
    });

    await new Promise(r => setTimeout(r, 1000));

    const getOptions = {
      hostname: spUrl.hostname,
      port: spUrl.port || 80,
      path: cgiPath,
      method: 'GET',
      timeout: 30000
    };

    const getReq = http.request(getOptions, (getRes) => {
      const chunks = [];
      getRes.on('data', chunk => chunks.push(chunk));
      getRes.on('end', () => {
        const buffer = Buffer.concat(chunks);
        res.set('Content-Type', getRes.headers['content-type'] || 'image/png');
        res.set('Cache-Control', 'public, max-age=60');
        res.send(buffer);
      });
    });

    getReq.on('error', (err) => res.status(502).json({ error: err.message }));
    getReq.on('timeout', () => { getReq.destroy(); res.status(504).json({ error: 'timeout' }); });
    getReq.end();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

loadConfig();

setTimeout(() => {
  syncConfig().then(() => {
    cron.schedule('*/5 * * * *', syncConfig);
    console.log('Config sync scheduled every 5 minutes');
  });
}, 10000);

cron.schedule('*/5 * * * *', prefetchCache);
prefetchCache();
console.log('Cache prefetch scheduled every 5 minutes');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SmokeDash running on port ${PORT}`);
  console.log(`SmokePing backend: ${SMOKEPING_URL}`);
});
