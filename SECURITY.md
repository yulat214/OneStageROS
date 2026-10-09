# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| 1.x     | No        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately by emailing: **shigineko64@yahoo.co.jp**

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any proof-of-concept code (if applicable)

You will receive an acknowledgement within 72 hours. We aim to release a patch within 14 days for critical issues.

## Scope

This project runs as a local development tool on the user's own machine.

- The backend (port 8000) and ROS Bridge (ports 9090 and 9091) always listen on `127.0.0.1`. The browser reaches them only through the Vite dev server (port 3000), which listens on `127.0.0.1` by default and on all interfaces when `ONESTAGE_EXPOSE=true`.
- Requests from other origins (other web sites, other ports on the same host) and requests whose `Host` is not `localhost` or an IP address (DNS rebinding) are rejected by the backend and by the ROS Bridge proxy in Vite (`server/auth.js`).
- These checks rely on headers sent by browsers. When port 3000 is reachable from other machines, `ONESTAGE_AUTH=token` should be set: every request then requires a session cookie obtained by logging in with the token in `~/.config/onestage-ros/token`.

The primary attack surface is:
- The Express API server (`server/assets-server.js`) — file read/write within `$HOME`, the command execution API and the terminal WebSocket (`/terminal`)
- Authentication and request checks (`server/auth.js`)
- The ROS Bridge proxy in Vite (`/rosbridge`, `/rosbridge-camera`, `vite.config.ts`)
- URDF/Xacro file processing in `server/sync-minimal.js` and `server/convert-xacro.js`
