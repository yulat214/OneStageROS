const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ▼ 出力先
const OUTPUT_DIR = path.join(__dirname, '../ros2_data');

// サーバー起動時に前回のデータを消去（ROS未接続のまま古いデータが表示されるのを防ぐ）
if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ros2 pkg prefix が失敗した場合、~/*/install/${pkgName} をフォールバック検索する
function findPkgPrefix(pkgName) {
    try {
        return execSync(`ros2 pkg prefix ${pkgName}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    } catch (_) {}

    // ホーム直下の全ワークスペースの install ディレクトリを検索
    const homeDir = os.homedir();
    try {
        const entries = fs.readdirSync(homeDir);
        for (const entry of entries) {
            const candidate = path.join(homeDir, entry, 'install', pkgName);
            if (fs.existsSync(candidate)) return candidate;
        }
    } catch (_) {}

    throw new Error(`Package not found: ${pkgName}`);
}

const ALLOWED_EXTS = new Set([
    '.urdf', '.xacro', '.xml',
    '.stl', '.dae', '.obj', '.glb', '.gltf',
    '.png', '.jpg', '.jpeg', '.tga', '.bmp', '.tif', '.tiff'
]);

// retry: true  → 失敗時に3秒後に再試行（起動時用）
// retry: false → 失敗時は即 reject（API呼び出し用）
function extractAssets({ retry = true } = {}) {
    return new Promise((resolve, reject) => {
        function attempt() {
            let urdfContent = '';
            try {
                const output = execSync('ros2 param get /robot_state_publisher robot_description', { encoding: 'utf-8', stdio: 'pipe' });
                const xmlStart = output.indexOf('<robot');
                if (xmlStart === -1) throw new Error('Valid URDF not found.');
                urdfContent = output.substring(xmlStart).replace(/\\n/g, '\n').replace(/\\"/g, '"');
            } catch (e) {
                if (retry) {
                    console.log('⏳ Waiting for robot_description. Is the robot running? Retrying in 3 seconds...');
                    setTimeout(attempt, 3000);
                } else {
                    reject(e);
                }
                return;
            }

            const requiredPackages = new Set();
            const packageRegex = /package:\/\/([\w_]+)\//g;
            const fileRegex = /file:\/\/.*?\/share\/([\w_]+)\//g;
            let match;

            while ((match = packageRegex.exec(urdfContent)) !== null) requiredPackages.add(match[1]);
            while ((match = fileRegex.exec(urdfContent)) !== null) requiredPackages.add(match[1]);

            console.log(`Targeted packages: ${Array.from(requiredPackages).join(', ')}`);

            if (fs.existsSync(OUTPUT_DIR)) {
                fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
            }
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });

            function mirrorDirectory(srcDir, destDir, pkgRoot) {
                const items = fs.readdirSync(srcDir);

                items.forEach(item => {
                    const srcPath = path.join(srcDir, item);
                    const destPath = path.join(destDir, item);
                    const stat = fs.statSync(srcPath);

                    if (stat.isDirectory()) {
                        if (item.startsWith('.') || item === 'build' || item === 'install') return;
                        mirrorDirectory(srcPath, destPath, pkgRoot);
                    } else {
                        const ext = path.extname(item).toLowerCase();
                        if (ALLOWED_EXTS.has(ext)) {
                            const parentDir = path.dirname(destPath);
                            if (!fs.existsSync(parentDir)) {
                                fs.mkdirSync(parentDir, { recursive: true });
                            }
                            if (!fs.existsSync(destPath)) {
                                fs.symlinkSync(srcPath, destPath);
                            }
                        }
                    }
                });
            }

            requiredPackages.forEach(pkgName => {
                try {
                    if (!/^[\w_]+$/.test(pkgName)) throw new Error(`Invalid package name: ${pkgName}`);
                    const prefixPath = findPkgPrefix(pkgName);
                    const sharePath = path.join(prefixPath, 'share', pkgName);

                    if (fs.existsSync(sharePath)) {
                        const destPkgRoot = path.join(OUTPUT_DIR, pkgName);
                        mirrorDirectory(sharePath, destPkgRoot, sharePath);
                        console.log(`✨ Filtered & Linked: ${pkgName}`);
                    }
                } catch (e) {
                    console.warn(`⚠️  Package not found or skipped: ${pkgName}`);
                }
            });

            let cleanUrdf = urdfContent.replace(/file:\/\/.*?\/share\/([\w_]+)\//g, 'package://$1/');
            fs.writeFileSync(path.join(OUTPUT_DIR, 'robot.urdf'), cleanUrdf);

            console.log('Minimal asset extraction complete!');
            console.log(`URDF saved to: ${path.join(OUTPUT_DIR, 'robot.urdf')}`);
            resolve();
        }

        attempt();
    });
}

module.exports = { extractAssets };

// 最初の実行をトリガー（失敗時はリトライ）
extractAssets({ retry: true }).catch(() => {});
