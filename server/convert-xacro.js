const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ROSワークスペースの場所
const WORKSPACE_DIR = process.env.ROS_WORKSPACE || path.join(process.env.HOME, 'ros2_ws/src');

console.log('🔄 Xacro Auto-Converter Started...');

function findXacroFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            if (file === '.git' || file === 'build' || file === 'install') return;
            findXacroFiles(filePath, fileList);
        } else if (file.endsWith('.xacro')) {
            // "model.urdf.xacro" のようなファイルのみ対象にする場合
            // if (file.includes('urdf.xacro')) { 
                fileList.push(filePath);
            // }
        }
    });
    return fileList;
}

try {
    const xacroFiles = findXacroFiles(WORKSPACE_DIR);
    console.log(`Found ${xacroFiles.length} .xacro files.`);

    xacroFiles.forEach(xacroPath => {
        // 出力ファイル名:
        // 例: robot.urdf.xacro -> robot.urdf
        // 例: robot.xacro -> robot.urdf
        let urdfPath = xacroPath.replace('.xacro', '');
        if (!urdfPath.endsWith('.urdf')) {
            urdfPath += '.urdf';
        }

        try {
            console.log(`🔨 Converting: ${path.basename(xacroPath)} -> ${path.basename(urdfPath)}`);
            
            const result = spawnSync('xacro', [xacroPath], { encoding: 'utf-8' });
            if (result.status !== 0) throw new Error(result.stderr || 'xacro failed');
            fs.writeFileSync(urdfPath, result.stdout);
            
        } catch (e) {
            console.error(`❌ Failed to convert ${path.basename(xacroPath)}`);
        }
    });
    console.log('✅ Xacro conversion complete!');

} catch (err) {
    console.error('Fatal Error:', err);
}
