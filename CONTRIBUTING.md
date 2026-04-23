# Contributing to OneStageROS

Thank you for your interest in contributing!

## Prerequisites

- Ubuntu 22.04 or 24.04
- ROS 2 Humble or later
- Node.js 20+
- Docker (for demo environment)

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies: `npm install`
3. Start the dev environment: `npm start`
4. Open `http://localhost:3000` in your browser

## Submitting Changes

1. Create a feature branch from `main`: `git checkout -b feat/your-feature`
2. Make your changes and test them against a running ROS 2 environment
3. Keep commits atomic and write clear commit messages
4. Open a pull request against `main` with a description of what and why

## Code Style

- TypeScript: follow the existing component structure; avoid `any` types
- Node.js: use `spawnSync`/`spawn` with argument arrays — never string-interpolate shell commands
- Prefer explicit error handling over silent catches

## Reporting Bugs

Please open an issue at https://github.com/an/OneStageROS/issues and include:
- OS and ROS 2 distribution
- Steps to reproduce
- Expected vs. actual behavior

For security vulnerabilities, see [SECURITY.md](SECURITY.md).
