const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const serveIndex = require('serve-index');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

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
        const result = items.map(item => ({
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

// --- 静的ファイル配信 ---
const staticOptions = {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.urdf')) res.setHeader('Content-Type', 'text/xml');
    }
};
app.use('/', express.static(ASSETS_DIR, staticOptions), serveIndex(ASSETS_DIR, {'icons': true}));

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

process.on('SIGINT', () => {
    console.log('\nShutting down all services...');
    runningProcesses.forEach(proc => proc.kill('SIGINT'));
    server.close(() => process.exit(0));
});