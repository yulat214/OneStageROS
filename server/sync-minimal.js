const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ▼ 出力先
const OUTPUT_DIR = path.join(__dirname, '../ros2_data');

const ALLOWED_EXTS = new Set([
    '.urdf', '.xacro', '.xml',
    '.stl', '.dae', '.obj', '.glb', '.gltf',
    '.png', '.jpg', '.jpeg', '.tga', '.bmp', '.tif', '.tiff'
]);

function extractAssets() {
    let urdfContent = '';
    try {
        const output = execSync('ros2 param get /robot_state_publisher robot_description', { encoding: 'utf-8', stdio: 'pipe' });
        const xmlStart = output.indexOf('<robot');
        if (xmlStart === -1) throw new Error('Valid URDF not found.');
        urdfContent = output.substring(xmlStart).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } catch (e) {
        console.log('⏳ Waiting for robot_description. Is the robot running? Retrying in 3 seconds...');
        setTimeout(extractAssets, 3000);
        return; // ここで一旦処理を抜ける
    }

    // ==========================================
    // ここから下は「取得に成功した」場合の処理
    // ==========================================

    const requiredPackages = new Set();
    const packageRegex = /package:\/\/([\w_]+)\//g;
    const fileRegex = /file:\/\/.*?\/share\/([\w_]+)\//g;
    let match;

    // package:// から抽出
    while ((match = packageRegex.exec(urdfContent)) !== null) requiredPackages.add(match[1]);
    // file://.../share/ から抽出
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
                
                // 再帰的に潜る
                mirrorDirectory(srcPath, destPath, pkgRoot);
            } else {
                // 拡張子チェック
                const ext = path.extname(item).toLowerCase();
                if (ALLOWED_EXTS.has(ext)) {
                    // 親ディレクトリを作成
                    const parentDir = path.dirname(destPath);
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true });
                    }
                    // シンボリックリンク作成
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
            // パッケージのインストール先を特定
            const prefixPath = execSync(`ros2 pkg prefix ${pkgName}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            const sharePath = path.join(prefixPath, 'share', pkgName);

            if (fs.existsSync(sharePath)) {
                // 出力先: tools/ros2_data/pkg_name/
                const destPkgRoot = path.join(OUTPUT_DIR, pkgName);
                
                // 再帰的に必要なファイルだけリンク
                mirrorDirectory(sharePath, destPkgRoot, sharePath);
                console.log(`✨ Filtered & Linked: ${pkgName}`);
            }
        } catch (e) {
            console.warn(`⚠️  Package not found or skipped: ${pkgName}`);
        }
    });

    let cleanUrdf = urdfContent.replace(/file:\/\/.*?\/share\/([\w_]+)\//g, 'package://$1/');

    // Webサーバーのルートに保存
    fs.writeFileSync(path.join(OUTPUT_DIR, 'robot.urdf'), cleanUrdf);

    console.log('Minimal asset extraction complete!');
    console.log(`URDF saved to: ${path.join(OUTPUT_DIR, 'robot.urdf')}`);
    
    // process.exit(0);
}

// 最初の実行をトリガー
extractAssets();
