# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately by emailing: **shigineko64@yahoo.co.jp**

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any proof-of-concept code (if applicable)

You will receive an acknowledgement within 72 hours. We aim to release a patch within 14 days for critical issues.

## Scope

This project runs as a local development tool on the user's own machine. The primary attack surface is:
- The Express API server (`server/assets-server.js`) — file read/write within `$HOME`
- URDF/Xacro file processing in `server/sync-minimal.js` and `server/convert-xacro.js`
- The WebSocket connection to ROS Bridge (port 9090)
