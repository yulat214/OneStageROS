# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-10-08

### Fixed
- Camera topics were published only while a subscriber existed, so they could not be selected in RViz. They are now published regardless of subscribers while publishing is turned on

### Changed
- Camera publishing is turned on and off with the button in the camera view header (off by default). When on, the color image, depth image and camera info are all published
- The camera publish rate can be selected from 1 / 2 / 5 / 10 Hz (5 Hz by default, previously about 10 Hz)

## [1.1.1] - 2026-10-08

### Changed
- Reset also removes placed objects after confirmation (when no world file is loaded)
- Reset publishes `/initialpose` so that Nav2 (AMCL) follows the reset pose. Requires `map` → `odom` on `/tf`

### Added
- Save with `Ctrl+S` / `Cmd+S` in the code editor

### Fixed
- Undo (`Ctrl+Z`) in the code editor no longer goes back past the loaded file content

## [1.1.0] - 2026-10-08

### Added
- User documentation under `docs/` (simulator, world editing, camera, debug log, editor, terminal, configuration, ROS interface, troubleshooting)

### Changed
- Rewrote README in Japanese with setup, usage and port information
- Updated CONTRIBUTING and SECURITY (supported versions, attack surface, repository URL)

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
