# RIFT Desktop

Native desktop application for RIFT built with [Tauri](https://tauri.app/).

## Overview

The desktop app wraps the RIFT web application in a native shell, providing:

- **Native window** with system integration and macOS vibrancy
- **Local PTY and command bridge** for desktop terminal workflows
- **Deep-link authentication** back into the existing main window
- **Cross-platform** builds for macOS, Windows, and Linux

## Prerequisites

### Required

- **Node.js** 20+
- **pnpm** 9+
- **Rust** 1.78+ ([install](https://rustup.rs/))

### Platform-specific

**macOS:**

```bash
xcode-select --install
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
```

**Windows:**

- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10/11)
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"

## Development

### Install dependencies

```bash
pnpm install
```

### Run in development mode

```bash
pnpm dev
```

This opens the desktop app against the local web server at
`http://localhost:3010`.

### Run with local web server

To develop against a local Next.js server:

```bash
# Terminal 1: Start the web app (from repo root)
pnpm dev

# Terminal 2: Start the desktop app with dev config
pnpm dev --config src-tauri/tauri.dev.conf.json
```

## Building

### Production release build

```bash
pnpm build:prod
```

Outputs to `src-tauri/target/release/bundle/`.

From the repository root, the equivalent command is:

```bash
pnpm desktop:build
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                        │
├─────────────────────────────────────────────────────────────┤
│  Rust Backend (src-tauri/)     │  WebView                   │
│  └─ main.rs/lib.rs             │  └─ Loads riftsys.app      │
│     ├─ PTY + command bridge    │     (uses web auth flow)   │
│     └─ Deep-link auth          │                            │
└─────────────────────────────────────────────────────────────┘
```

The web application owns the product UI and authentication. The native Rust
layer retains the local PTY, command execution, file access, and deep-link
bridges required by desktop-only workflows.

## CI/CD

GitHub Actions workflow (`.github/workflows/desktop-build.yml`) builds for:

| Platform | Target                     | Output              |
| -------- | -------------------------- | ------------------- |
| macOS    | `aarch64-apple-darwin`     | `.dmg`, `.app`      |
| macOS    | `x86_64-apple-darwin`      | `.dmg`, `.app`      |
| macOS    | Universal                  | `.dmg` (combined)   |
| Windows  | `x86_64-pc-windows-msvc`   | `.msi`, `.exe`      |
| Linux    | `x86_64-unknown-linux-gnu` | `.AppImage`, `.deb` |

### Triggering builds

**Via tag:**

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

**Via workflow dispatch:**
Go to Actions → "Build Desktop App" → Run workflow

## Code Signing

### macOS

Local and certificate-free CI builds use Tauri's `-` pseudo-identity so the
entire `.app` bundle receives a valid ad-hoc signature. This prevents malformed
bundle signatures, but macOS can still require users to explicitly allow the
app in Privacy & Security.

Public downloads must be signed and notarized with a Developer ID Application
certificate. To enable that release path:

1. Get an Apple Developer ID Application certificate.
2. Export it as a `.p12` file.
3. Set in CI:
   - `APPLE_CERTIFICATE` (base64-encoded .p12)
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY`
   - `APPLE_ID`
   - `APPLE_PASSWORD` (app-specific password)
   - `APPLE_TEAM_ID`

The macOS CI job verifies every generated app with
`codesign --verify --deep --strict` before uploading it.

### Windows

1. Get an EV code signing certificate
2. Set in CI:
   - Certificate details (varies by provider)

## Troubleshooting

### "WebView2 not found" (Windows)

Install WebView2 from Microsoft: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### "gtk/webkit not found" (Linux)

Install development libraries:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev
```

## License

Proprietary - RIFT
