# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-10-09

### Changed
- **Breaking:** The browser connects only to port 3000. The backend API and terminal (`/api`, `/workspace`, `/ros2_data`, `/terminal`) are proxied by Vite to the backend, and ROS Bridge (`/rosbridge`, `/rosbridge-camera`) is proxied by Vite directly to ROS Bridge
- **Breaking:** The backend (8000) and ROS Bridge (9090, 9091) always listen on `127.0.0.1`. Programs on a Docker host can no longer connect to ROS Bridge directly
- **Breaking:** The web UI (3000) listens on `127.0.0.1` by default. Set `ONESTAGE_EXPOSE=true` to allow access from a Docker host or other machines. Docker setups only need to forward port 3000
- **Breaking:** ROS asset files are served under `/ros2_data/` instead of the server root
- Settings are read from `.env` in the repository root (`server/.env` is still read). AI settings saved from the UI are written to `.env` in the repository root

### Added
- Optional login (`ONESTAGE_AUTH=token`). The token is stored in `~/.config/onestage-ros/token` and shown by `npm run token` (`npm run token -- --reset` regenerates it). The browser opened by `npm start` logs in automatically
- `.env.example`

### Security
- Requests from other web sites and from other ports on the same host are rejected (`Origin`, `Sec-Fetch-Site`). Previously, any web page could run commands through `/api/run` and connect to ROS Bridge
- Requests whose `Host` is not `localhost` or an IP address are rejected (DNS rebinding)
- AI settings containing line breaks are rejected, so that other settings cannot be written into `.env`
- All `.env*` files except `.env.example` are excluded from Git

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
