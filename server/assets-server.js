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
const SESSION_ID = Date.now().toString();

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
    try {
        if (!req.query.path) return res.status(400).json({ error: 'path パラメータが必要です' });

        // パストラバーサル対策（シンボリックリンクも含めて解決）
        const sdfPath = path.resolve(WORKSPACE_ROOT, req.query.path.replace(/^\/+/, ''));
        if (!fs.existsSync(sdfPath)) return res.status(404).json({ error: 'ファイルが見つかりません' });

        // model:// URI 解決用ディレクトリリスト（GAZEBO_MODEL_PATH + 既定パス）
        const GAZEBO_SEARCH_DIRS = [
            ...(process.env.GAZEBO_MODEL_PATH || '').split(':').filter(Boolean),
            '/usr/share/gazebo/models',
            '/usr/share/gazebo-11/models',
            '/usr/share/gazebo-9/models',
        ];

        function resolveModelUri(uri) {
            if (!uri) return null;
            if (uri.startsWith('file://')) return uri.replace('file://', '');
            if (uri.startsWith('model://')) {
                const rest = uri.replace('model://', '');
                const slashIdx = rest.indexOf('/');
                const modelName = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
                const subPath  = slashIdx >= 0 ? rest.slice(slashIdx + 1) : '';
                for (const dir of GAZEBO_SEARCH_DIRS) {
                    const candidate = path.join(dir, modelName, subPath);
                    if (fs.existsSync(candidate)) return candidate;
                }
            }
            return null;
        }

        function absToUrl(absPath) {
            const real = path.resolve(absPath);
            if (real.startsWith(WORKSPACE_ROOT)) return '/workspace' + real.slice(WORKSPACE_ROOT.length);
            return null;
        }

        function parsePose(raw) {
            if (!raw) return [0, 0, 0, 0, 0, 0];
            const nums = String(raw).trim().split(/\s+/).map(Number);
            while (nums.length < 6) nums.push(0);
            return nums;
        }

        function addPose(a, b) {
            return [a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3], a[4]+b[4], a[5]+b[5]];
        }

        const objects = [];

        // 単一リンク配列 + 親ポーズ → visuals を objects に追加
        function extractVisuals(linkArr, parentPose, modelName) {
            const links = Array.isArray(linkArr) ? linkArr : (linkArr ? [linkArr] : []);
            for (const link of links) {
                const linkPose = parsePose(link.pose?.[0]);
                const base = addPose(parentPose, linkPose);
                for (const visual of (link.visual || [])) {
                    const vPose = parsePose(visual.pose?.[0]);
                    const pose  = addPose(base, vPose);
                    const vName = visual.$?.name || 'visual';
                    const geo   = visual.geometry?.[0];
                    if (!geo) continue;

                    if (geo.mesh) {
                        const uri = geo.mesh[0].uri?.[0];
                        const abs = resolveModelUri(uri);
                        const url = abs ? absToUrl(abs) : null;
                        const scaleStr = geo.mesh[0].scale?.[0] ?? '1 1 1';
                        const scale = String(scaleStr).trim().split(/\s+/).map(Number);
                        if (url) objects.push({ type: 'mesh', name: `${modelName}/${vName}`, url, scale, pose });
                    } else if (geo.cylinder) {
                        objects.push({
                            type: 'cylinder', name: `${modelName}/${vName}`, pose,
                            radius: parseFloat(geo.cylinder[0].radius?.[0] ?? 0.1),
                            length: parseFloat(geo.cylinder[0].length?.[0] ?? 0.5),
                        });
                    } else if (geo.box) {
                        objects.push({
                            type: 'box', name: `${modelName}/${vName}`, pose,
                            size: (geo.box[0].size?.[0] ?? '1 1 1').trim().split(/\s+/).map(Number),
                        });
                    } else if (geo.sphere) {
                        objects.push({
                            type: 'sphere', name: `${modelName}/${vName}`, pose,
                            radius: parseFloat(geo.sphere[0].radius?.[0] ?? 0.5),
                        });
                    }
                }
            }
        }

        // model 要素を再帰的に処理（<include> 対応）
        function processModel(m, parentPose) {
            const mPose = parsePose(m.pose?.[0]);
            const pose  = addPose(parentPose || [0,0,0,0,0,0], mPose);
            const mName = m.$?.name || 'model';
            if (m.link) extractVisuals(m.link, pose, mName);
            for (const inc of (m.include || [])) {
                processInclude(inc, pose);
            }
        }

        // <include> の model:// を解決して再帰パース
        function processInclude(inc, parentPose) {
            const uri  = inc.uri?.[0];
            const pose = addPose(parsePose(inc.pose?.[0]), parentPose || [0,0,0,0,0,0]);
            if (!uri?.startsWith('model://')) return;
            const modelName = uri.replace('model://', '');
            // ground_plane / sun はスキップ
            if (['ground_plane', 'sun'].includes(modelName)) return;

            for (const dir of GAZEBO_SEARCH_DIRS) {
                const modelDir = path.join(dir, modelName);
                if (!fs.existsSync(modelDir)) continue;

                // model.config から SDF ファイル名を取得
                let sdfFile = 'model.sdf';
                const configPath = path.join(modelDir, 'model.config');
                if (fs.existsSync(configPath)) {
                    try {
                        const cfgXml = fs.readFileSync(configPath, 'utf-8');
                        const m = cfgXml.match(/<sdf[^>]*>([^<]+)<\/sdf>/);
                        if (m) sdfFile = m[1].trim();
                    } catch { /* ignore */ }
                }

                const incSdfPath = path.join(modelDir, sdfFile);
                if (!fs.existsSync(incSdfPath)) continue;
                try {
                    const incXml = fs.readFileSync(incSdfPath, 'utf-8');
                    const parser2 = new xml2js.Parser();
                    parser2.parseString(incXml, (err, r) => {
                        if (err || !r?.sdf) return;
                        if (r.sdf.model) {
                            const m = Array.isArray(r.sdf.model) ? r.sdf.model[0] : r.sdf.model;
                            processModel(m, pose);
                        }
                    });
                } catch { /* ignore */ }
                break;
            }
        }

        // メインパース
        const xml    = fs.readFileSync(sdfPath, 'utf-8');
        const parser = new xml2js.Parser();
        const parsed = await parser.parseStringPromise(xml);
        const sdf    = parsed?.sdf;
        if (!sdf) return res.status(400).json({ error: '有効な SDF ファイルではありません' });

        let robotPose = null;

        if (sdf.world) {
            const world = sdf.world[0];
            for (const m   of (world.model   || [])) processModel(m, [0,0,0,0,0,0]);
            for (const inc of (world.include  || [])) {
                processInclude(inc, [0,0,0,0,0,0]);
                // 最初の非静的 include の pose をロボット初期位置候補として収集
                if (robotPose === null) {
                    const uri = inc.uri?.[0] || '';
                    const mName = uri.replace('model://', '');
                    if (!['ground_plane', 'sun'].includes(mName) && inc.pose?.[0]) {
                        robotPose = parsePose(inc.pose[0]);
                    }
                }
            }
        } else if (sdf.model) {
            const m = Array.isArray(sdf.model) ? sdf.model[0] : sdf.model;
            processModel(m, [0,0,0,0,0,0]);
        }

        res.json({ objects, robotPose });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/session', (req, res) => {
    res.json({ sessionId: SESSION_ID });
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
        fs.chmodSync(absPath, 0o755);
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

// --- 実行 API ---

let currentRunProcess = null;

app.get('/api/run', (req, res) => {
    const cmd = req.query.cmd;
    if (!cmd) {
        res.status(400).json({ error: 'cmd パラメータが必要です' });
        return;
    }

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

    if (currentRunProcess) {
        currentRunProcess.kill('SIGINT');
        currentRunProcess = null;
    }

    sendEvent('system', `$ ${cmd}\n`);

    const proc = spawn('bash', ['-c', cmd], {
        cwd: os.homedir(),
        env: { ...process.env }
    });
    currentRunProcess = proc;

    proc.stdout.on('data', (d) => sendEvent('stdout', stripAnsi(d.toString())));
    proc.stderr.on('data', (d) => sendEvent('stderr', stripAnsi(d.toString())));

    proc.on('error', (err) => {
        currentRunProcess = null;
        sendEvent('error', err.message);
        sendExit(1);
    });

    proc.on('close', (code) => {
        currentRunProcess = null;
        sendExit(code ?? 1);
    });

    req.on('close', () => {
        if (proc && !proc.killed) proc.kill('SIGINT');
    });
});

app.post('/api/run/cancel', (req, res) => {
    if (currentRunProcess) {
        currentRunProcess.kill('SIGINT');
        currentRunProcess = null;
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