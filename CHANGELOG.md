# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-23

### Added
- URDF / Xacro robot model visualizer (Three.js + urdf-loaders)
- In-browser code editor with Monaco Editor for editing ROS 2 source files
- Real-time debug console subscribed to `/rosout`
- Snapshot capture of active ROS nodes and topics
- Japanese ↔ translation support for log messages
- Simultaneous startup of `rosbridge_websocket` and `rosapi_node`
- Docker demo environment (`OneStageROS_demo/`) with TurtleBot3

### Security
- Fixed shell injection in `server/convert-xacro.js` (replaced `execSync` template string with `spawnSync` argument array)
- Fixed shell injection in `server/sync-minimal.js` (added package name validation)
- Fixed TOCTOU race condition in `POST /api/file` (added `fs.realpathSync` post-`mkdirSync` check)
- Added CORS origin restriction and rate limiting to Express API server
- Added 2 MB file-size limit on `GET /api/file`
