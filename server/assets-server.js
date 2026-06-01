const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const serveIndex = require('serve-index');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const xml2js = require('xml2js');

const app = express();
const PORT = 8000;

const WORKSPACE_ROOT = fs.realpathSync(os.homedir());
const ASSETS_DIR = path.join(__dirname, '../ros2_data');

app.use(cors({ origin: [`http://localhost:3000`, `http://127.0.0.1:3000`] }));
app.use(express.json({ limit: '1mb' }));
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'Invalid JSON' });
    next(err);
});

const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

console.log('---------------------------------------------------');
try {
    require('./sync-minimal');
} catch (e) {
    console.error('Asset sync failed:', e);
}
console.log('---------------------------------------------------');

function getSafeAbsolutePath(relPath) {
    if (!relPath) return WORKSPACE_ROOT;
    const safeRelPath = relPath.replace(/^\/+/, '');
    return path.resolve(WORKSPACE_ROOT, safeRelPath);
}

function assertWithinWorkspace(absPath) {
    // Resolve symlinks to prevent TOCTOU attacks
    const real = fs.existsSync(absPath) ? fs.realpathSync(absPath) : absPath;
    if (!real.startsWith(WORKSPACE_ROOT + path.sep) && real !== WORKSPACE_ROOT) {
        throw Object.assign(new Error('Access denied'), { status: 403 });
    }
    return real;
}

// --- エディター用API ---

app.get('/api/ls', (req, res) => {
    try {
        const absPath = getSafeAbsolutePath(req.query.path);
        if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Directory not found' });
        assertWithinWorkspace(absPath);
        const items = fs.readdirSync(absPath, { withFileTypes: true });
        const result = items
            .filter(item => !item.name.startsWith('.'))
            .map(item => ({
                name: item.name,
                isDirectory: item.isDirectory(),
                path: req.query.path ? path.join(req.query.path, item.name) : item.name
            }));
        res.json(result);
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

app.get('/api/file', (req, res) => {
    try {
        const absPath = getSafeAbsolutePath(req.query.path);
        if (!fs.existsSync(absPath)) return res.status(404).send('Not Found');
        assertWithinWorkspace(absPath);
        const stat = fs.statSync(absPath);
        if (stat.size > 2 * 1024 * 1024) return res.status(413).json({ error: 'File too large to edit (max 2 MB)' });
        const content = fs.readFileSync(absPath, 'utf-8');
        res.json({ content });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

app.get('/api/convert-sdf', async (req, res) => {
    const sdfPath = path.join(WORKSPACE_ROOT, req.query.path);
    const xml = fs.readFileSync(sdfPath, 'utf-8');
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);

    const world = result.sdf.world[0];
    const models = world.model.map(m => {
        return {
            name: m.$.name,
            uri: m.link[0].visual[0].geometry[0].mesh[0].uri[0], // meshのパス
            pose: m.pose[0].split(' ').map(Number) // [x, y, z, roll, pitch, yaw]
        };
    });

    res.json({ objects: models });
});

app.post('/api/file', (req, res) => {
    try {
        const absPath = getSafeAbsolutePath(req.body.path);
        // Pre-write check (path may not exist yet)
        const preReal = path.resolve(absPath);
        if (!preReal.startsWith(WORKSPACE_ROOT + path.sep) && preReal !== WORKSPACE_ROOT) {
            return res.status(403).send('Forbidden');
        }
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Post-mkdirSync re-check resolves any symlinks that may have been swapped in
        assertWithinWorkspace(dir);
        fs.writeFileSync(absPath, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

// --- ビルド API ---

let currentBuildProcess = null;

function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function expandWorkspacePath(p) {
    if (!p) return path.join(os.homedir(), 'ros2_ws');
    if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(p === '~' ? 1 : 2));
    return getSafeAbsolutePath(p);
}

app.get('/api/build', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (type, text) => {
        res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
    };
    const sendExit = (code) => {
        res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
        res.end();
    };

    let workspacePath;
    try {
        workspacePath = expandWorkspacePath(req.query.workspace);
        assertWithinWorkspace(workspacePath);
    } catch (e) {
        sendEvent('error', `ワークスペースエラー: ${e.message}`);
        sendExit(1);
        return;
    }

    if (!fs.existsSync(workspacePath)) {
        sendEvent('error', `ワークスペースが見つかりません: ${workspacePath}\n~/ros2_ws など正しいパスを指定してください。`);
        sendExit(1);
        return;
    }

    if (currentBuildProcess) {
        currentBuildProcess.kill('SIGINT');
        currentBuildProcess = null;
    }

    const args = ['build'];
    if (req.query.symlink === 'true') args.push('--symlink-install');
    if (req.query.packages) {
        const pkgs = req.query.packages.split(',').map(s => s.trim()).filter(Boolean);
        if (pkgs.length > 0) args.push('--packages-select', ...pkgs);
    }

    sendEvent('system', `$ colcon ${args.join(' ')}\n作業ディレクトリ: ${workspacePath}\n`);

    const proc = spawn('colcon', args, {
        cwd: workspacePath,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' }
    });
    currentBuildProcess = proc;

    proc.stdout.on('data', (d) => sendEvent('stdout', stripAnsi(d.toString())));
    proc.stderr.on('data', (d) => sendEvent('stderr', stripAnsi(d.toString())));

    proc.on('error', (err) => {
        currentBuildProcess = null;
        const msg = err.code === 'ENOENT'
            ? 'colcon が見つかりません。ROS 2 環境がセットアップされているか確認してください。'
            : err.message;
        sendEvent('error', msg);
        sendExit(1);
    });

    proc.on('close', (code) => {
        currentBuildProcess = null;
        sendExit(code ?? 1);
    });

    req.on('close', () => {
        if (proc && !proc.killed) proc.kill('SIGINT');
    });
});

app.post('/api/build/cancel', (req, res) => {
    if (currentBuildProcess) {
        currentBuildProcess.kill('SIGINT');
        currentBuildProcess = null;
        res.json({ cancelled: true });
    } else {
        res.json({ cancelled: false });
    }
});

// --- 静的ファイル配信 ---
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.urdf')) res.setHeader('Content-Type', 'text/xml');
    }
};
app.use('/', express.static(ASSETS_DIR, staticOptions), serveIndex(ASSETS_DIR, {'icons': true}));
app.use('/workspace', express.static(WORKSPACE_ROOT));

const runningProcesses = [];

function startNode(command, args, label) {
    console.log(`Starting ${label}...`);
    const proc = spawn(command, args);

    proc.stdout.on('data', (data) => console.log(`[${label}] ${data.toString().trim()}`));
    proc.stderr.on('data', (data) => console.error(`[${label} Error] ${data.toString().trim()}`));
    
    runningProcesses.push(proc);
    return proc;
}

// 1. rosbridge_websocket の起動
startNode('ros2', [
    'launch', 
    'rosbridge_server', 
    'rosbridge_websocket_launch.xml'
], 'Rosbridge');

// 2. rosapi_node の起動
startNode('ros2', [
    'run', 
    'rosapi', 
    'rosapi_node'
], 'RosAPI');

// ===================================================

const server = app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Editor Root: ${WORKSPACE_ROOT}`);
});

// --- ターミナル WebSocket ---
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const wss = new WebSocketServer({ server, path: '/terminal' });

wss.on('connection', (ws, req) => {
    const origin = req.headers.origin || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
        ws.close(1008, 'Forbidden');
        return;
    }

    const shell = process.env.SHELL || '/bin/bash';
    const ptyProc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: os.homedir(),
        env: process.env,
    });

    ptyProc.onData(data => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
    });

    ws.on('message', (raw) => {
        try {
            const { type, data, cols, rows } = JSON.parse(raw.toString());
            if (type === 'input') ptyProc.write(data);
            if (type === 'resize') ptyProc.resize(Math.max(1, cols), Math.max(1, rows));
        } catch {}
    });

    ws.on('close', () => { try { ptyProc.kill(); } catch {} });
    ptyProc.onExit(() => { if (ws.readyState === 1) ws.close(); });
});

console.log('Terminal WebSocket: ws://localhost:' + PORT + '/terminal');

// ===================================================

process.on('SIGINT', () => {
    console.log('\nShutting down all services...');
    runningProcesses.forEach(proc => proc.kill('SIGINT'));
    wss.close();
    server.close(() => process.exit(0));
});