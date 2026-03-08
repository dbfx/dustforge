# DustForge

<p align="center">
  <img src="logo.png" alt="DustForge" width="128" />
</p>

<p align="center">
  A modern, open-source system cleaner for Windows.
</p>

<p align="center">
  <a href="https://github.com/dbfx/dustforge/releases"><img src="https://img.shields.io/github/v/release/dbfx/dustforge?style=flat-square" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dbfx/dustforge?style=flat-square" alt="License" /></a>
  <a href="https://github.com/dbfx/dustforge/actions"><img src="https://img.shields.io/github/actions/workflow/status/dbfx/dustforge/release.yml?style=flat-square&label=build" alt="Build" /></a>
</p>

---

## Features

- **System Cleaner** — Remove temp files, logs, caches, and other system junk
- **Browser Cleaner** — Clear browser caches, cookies, and history across all major browsers
- **App Cleaner** — Clean up leftover data from installed applications
- **Gaming Cleaner** — Free space from game launchers and cached game data
- **Recycle Bin** — Scan and empty the recycle bin
- **Registry Cleaner** — Detect and fix broken or orphaned registry entries
- **Startup Manager** — Control which programs launch at startup
- **Network Cleanup** — Clean DNS cache, network logs, and related data
- **Disk Analyzer** — Visualize disk usage and find large files
- **Debloater** — Remove pre-installed Windows bloatware
- **Cleaning History** — Track past cleaning sessions and space recovered
- **Scheduled Scans** — Set up automatic scans on a schedule
- **One-Click Clean** — Scan and clean everything with a single click from the dashboard

## Tech Stack

- [Electron](https://www.electronjs.org/) — Desktop framework
- [React](https://react.dev/) — UI library
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Zustand](https://zustand.docs.pmnd.rs/) — State management
- [electron-vite](https://electron-vite.org/) — Build tooling
- [TypeScript](https://www.typescriptlang.org/) — Type safety

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Install

```bash
git clone https://github.com/dbfx/dustforge.git
cd dustforge
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Package Installer

```bash
npm run package
```

### Create a Release

```bash
npm run release
```

This builds the app and publishes a draft GitHub release with the installer attached. Set the `GH_TOKEN` environment variable to a GitHub personal access token with `repo` scope.

## License

[MIT](LICENSE)
