// ロボット移動・odom TF の定期 publish をサーバー側で行うシミュレーションコア。
//
// 以前はブラウザのシミュレーションループが /tf・/onestage/odom を rosbridge 経由で出していたが、
//  - タブ非表示・最小化で OS/ブラウザの省電力制御（Windows の EcoQoS 等）により周期が落ちる
//  - Windows + WSL2 + Docker ではブラウザ → rosbridge の経路で遅延が蓄積し、TF が秒単位で遅れる
//  - スタンプがブラウザ（Windows）の時計になり、ROS 側の時計とずれうる
// ため、Nav2/AMCL が TF を取れず停止していた。rclnodejs で直接 publish すればこれらに依存しない。
//
// ロボットの位置はここが正（ブラウザは /onestage/sim_pose を購読して描画するだけ）。
// ブラウザからの操作（初期姿勢・リセット・一時停止・移動機構の有無）は HTTP API で受ける。

const RATE_HZ = 30;
const MAX_DT = 0.1; // 周期が乱れても位置が飛ばないよう dt を 100ms でキャップ
const LIDAR_Z = 0.15; // base_link → base_scan（ブラウザの LiDAR シミュレーションと揃える）
// LiDAR の仕様（ブラウザ側 src/hooks/useLidarSim.ts の local モードと揃える）
const LIDAR = { numRays: 360, minRange: 0.12, maxRange: 3.5, everyNTicks: 3 /* 30Hz / 3 = 10Hz */ };
// three.js の material.side（FrontSide / BackSide / DoubleSide）
const FRONT_SIDE = 0;
const BACK_SIDE = 1;
// 断面の線分 1 本あたりの要素数: [x1, y1, x2, y2, nx, ny, side]
const SEG_STRIDE = 7;

const state = {
    // 最初の姿勢設定（ブラウザのワールド読込）までは TF を出さない
    initialized: false,
    // シミュレータのワールド座標でのロボット位置（ブラウザの見た目と同じ座標系）
    pose: { x: 0, y: 0, yaw: 0 },
    // 2D Pose Estimate 受信時点の pose。odom TF はここからの相対値を出す
    odomOrigin: { x: 0, y: 0, yaw: 0 },
    cmdVel: { linearX: 0, angularZ: 0 },
    paused: false,
    // "world" リンクに固定されたアーム等は /cmd_vel を無視する（ブラウザが URDF から判定して通知）
    hasMobileBase: true,
    // 障害物を LiDAR の高さの水平面で切った線分（シミュレータのワールド座標）。
    // ブラウザが障害物の変化時に送ってくる。受け取るまでは /scan を出さない
    obstacleSegs: null,
};

let node = null;
let pubs = null;
let rclnodejs = null;

function quatFromYaw(yaw) {
    return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

function scanTransform(stamp) {
    return {
        header: { stamp, frame_id: 'base_link' },
        child_frame_id: 'base_scan',
        transform: {
            translation: { x: 0, y: 0, z: LIDAR_Z },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
    };
}

// odom 原点から見た現在 pose（odom → base_link）
function odomRelativePose() {
    const { pose, odomOrigin: o } = state;
    const dx = pose.x - o.x;
    const dy = pose.y - o.y;
    const c = Math.cos(o.yaw);
    const s = Math.sin(o.yaw);
    return { x: dx * c + dy * s, y: -dx * s + dy * c, yaw: pose.yaw - o.yaw };
}

// ロボット位置から 360 本のレイを線分と交差させる（ブラウザ側 castRay と同じ判定）
function computeRanges() {
    const segs = state.obstacleSegs;
    const { numRays, minRange, maxRange } = LIDAR;
    const { x: px, y: py, yaw } = state.pose;
    const ranges = new Array(numRays);
    for (let i = 0; i < numRays; i++) {
        const ang = yaw + (i * Math.PI) / 180;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        let best = Infinity;
        for (let k = 0; k < segs.length; k += SEG_STRIDE) {
            const x1 = segs[k] - px;
            const y1 = segs[k + 1] - py;
            const ex = segs[k + 2] - segs[k];
            const ey = segs[k + 3] - segs[k + 1];
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) continue; // レイと線分が平行
            const t = (x1 * ey - y1 * ex) / den; // レイ上の距離
            if (t < minRange || t > maxRange || t >= best) continue;
            const u = (x1 * dy - y1 * dx) / den; // 線分上の位置
            if (u < 0 || u > 1) continue;
            const facing = dx * segs[k + 4] + dy * segs[k + 5]; // < 0 なら表面に当たる
            const side = segs[k + 6];
            if (side === FRONT_SIDE && facing >= 0) continue;
            if (side === BACK_SIDE && facing <= 0) continue;
            best = t;
        }
        // 当たらなかったレイは range_max を少し超える値（ブラウザ実装と同じ。理由は useLidarSim.ts 参照）
        ranges[i] = best === Infinity ? maxRange + 0.001 : best;
    }
    return ranges;
}

function publishScan(stamp) {
    const { numRays, minRange, maxRange } = LIDAR;
    pubs.scan.publish({
        header: { stamp, frame_id: 'base_scan' },
        angle_min: 0.0,
        angle_max: 2.0 * Math.PI,
        angle_increment: (Math.PI * 2.0) / numRays,
        time_increment: 0.0,
        scan_time: 0.1,
        range_min: minRange,
        range_max: maxRange,
        ranges: computeRanges(),
        intensities: [],
    });
}

function publishState({ withScan = false } = {}) {
    if (!pubs || !state.initialized) return;
    // TF・odom・sim_pose・scan は必ず同じスタンプにする（scan の位置と TF が正確に対応する）
    const stamp = node.now().toMsg();
    const rel = odomRelativePose();
    const relQ = quatFromYaw(rel.yaw);

    pubs.tf.publish({
        transforms: [
            {
                header: { stamp, frame_id: 'odom' },
                child_frame_id: 'base_link',
                transform: {
                    translation: { x: rel.x, y: rel.y, z: 0 },
                    rotation: relQ,
                },
            },
            // /tf_static を取り逃したノードのため毎周期 /tf にも含める（従来のブラウザ実装と同じ）
            scanTransform(stamp),
        ],
    });

    // AMCL のモーションモデル用。diff_drive の /odom と衝突しないよう専用トピック
    pubs.odom.publish({
        header: { stamp, frame_id: 'odom' },
        child_frame_id: 'base_link',
        pose: {
            pose: { position: { x: rel.x, y: rel.y, z: 0 }, orientation: relQ },
            covariance: new Array(36).fill(0),
        },
        twist: {
            twist: {
                linear: { x: state.paused ? 0 : state.cmdVel.linearX, y: 0, z: 0 },
                angular: { x: 0, y: 0, z: state.paused ? 0 : state.cmdVel.angularZ },
            },
            covariance: new Array(36).fill(0),
        },
    });

    // ブラウザの描画用（ワールド座標）
    pubs.simPose.publish({
        header: { stamp, frame_id: 'onestage_world' },
        pose: {
            position: { x: state.pose.x, y: state.pose.y, z: 0 },
            orientation: quatFromYaw(state.pose.yaw),
        },
    });

    if (withScan && state.obstacleSegs) publishScan(stamp);
}

function step(dt) {
    if (!state.initialized || state.paused || !state.hasMobileBase) return;
    const { linearX, angularZ } = state.cmdVel;
    const p = state.pose;
    p.yaw += angularZ * dt;
    p.x += linearX * Math.cos(p.yaw) * dt;
    p.y += linearX * Math.sin(p.yaw) * dt;
}

async function start(rcl) {
    rclnodejs = rcl;
    const { QoS } = rclnodejs;
    node = rclnodejs.createNode('onestage_sim');

    const latched = new QoS(
        QoS.HistoryPolicy.RMW_QOS_POLICY_HISTORY_KEEP_LAST, 1,
        QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_RELIABLE,
        QoS.DurabilityPolicy.RMW_QOS_POLICY_DURABILITY_TRANSIENT_LOCAL,
    );
    const tfStatic = node.createPublisher('tf2_msgs/msg/TFMessage', '/tf_static', { qos: latched });
    tfStatic.publish({ transforms: [scanTransform(node.now().toMsg())] });

    const p = {
        tf: node.createPublisher('tf2_msgs/msg/TFMessage', '/tf'),
        odom: node.createPublisher('nav_msgs/msg/Odometry', '/onestage/odom'),
        simPose: node.createPublisher('geometry_msgs/msg/PoseStamped', '/onestage/sim_pose'),
        scan: node.createPublisher('sensor_msgs/msg/LaserScan', '/scan'),
    };

    node.createSubscription('geometry_msgs/msg/Twist', '/cmd_vel', (msg) => {
        state.cmdVel = { linearX: msg.linear.x, angularZ: msg.angular.z };
    });

    // 2D Pose Estimate: 見た目の位置は動かさず、odom 原点だけ現在位置にする。
    // AMCL が次の scan で odom → base_link を引く前に TF=(0,0,0) を出しておき、
    // map → odom = initialpose となるようにする（ずれ防止）
    node.createSubscription('geometry_msgs/msg/PoseWithCovarianceStamped', '/initialpose', () => {
        state.odomOrigin = { ...state.pose };
        publishState();
    });

    rclnodejs.spin(node);
    // 途中で失敗した場合に enabled:true と報告しないよう、準備が全部済んでから公開する
    pubs = p;

    // Node.js のタイマーはブラウザと違い、ウィンドウ状態による間引きを受けない
    let last = process.hrtime.bigint();
    let tick = 0;
    setInterval(() => {
        const now = process.hrtime.bigint();
        const dt = Math.min(Number(now - last) / 1e9, MAX_DT);
        last = now;
        step(dt);
        publishState({ withScan: tick++ % LIDAR.everyNTicks === 0 });
    }, 1000 / RATE_HZ);

    console.log(`[SIM] server-side simulation started (${RATE_HZ} Hz: /tf, /onestage/odom, /onestage/sim_pose; /scan ${RATE_HZ / LIDAR.everyNTicks} Hz)`);
}

function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function registerRoutes(app) {
    app.get('/api/sim/status', (req, res) => {
        res.json({
            enabled: !!pubs,
            initialized: state.initialized,
            pose: state.pose,
            paused: state.paused,
        });
    });

    // ロボット姿勢の設定（ワールド読込・リセット時）。odom 原点も同じ位置にし、速度指令は止める。
    // ifUninitialized=true のときは、まだ誰も初期化していない場合だけ適用する
    // （ページ再読込や 2 台目のブラウザが、動作中のロボットを localStorage の古い位置へ戻さないため）
    app.post('/api/sim/pose', (req, res) => {
        const { x, y, yaw, ifUninitialized } = req.body ?? {};
        if (!isNum(x) || !isNum(y) || !isNum(yaw)) return res.status(400).json({ error: 'x, y, yaw は数値が必要です' });
        if (ifUninitialized && state.initialized) return res.json({ applied: false, pose: state.pose });
        state.pose = { x, y, yaw };
        state.odomOrigin = { x, y, yaw };
        state.cmdVel = { linearX: 0, angularZ: 0 };
        state.initialized = true;
        publishState();
        res.json({ applied: true, pose: state.pose });
    });

    // 障害物の断面（線分）。ブラウザが変化時と定期的に送る
    app.post('/api/sim/obstacles', (req, res) => {
        const { segments } = req.body ?? {};
        if (!Array.isArray(segments) || segments.length % SEG_STRIDE !== 0 || !segments.every(isNum)) {
            return res.status(400).json({ error: `segments は長さが ${SEG_STRIDE} の倍数の数値配列が必要です` });
        }
        state.obstacleSegs = segments;
        res.json({ count: segments.length / SEG_STRIDE });
    });

    app.post('/api/sim/config', (req, res) => {
        const { paused, hasMobileBase } = req.body ?? {};
        if (typeof paused === 'boolean') state.paused = paused;
        if (typeof hasMobileBase === 'boolean') state.hasMobileBase = hasMobileBase;
        res.json({ paused: state.paused, hasMobileBase: state.hasMobileBase });
    });
}

module.exports = { start, registerRoutes };
