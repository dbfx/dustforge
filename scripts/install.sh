#!/usr/bin/env bash
# DustForge Linux installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dbfx/dustforge/main/scripts/install.sh | bash
#   curl -fsSL ... | bash -s -- --api-key YOUR_KEY
#   curl -fsSL ... | bash -s -- --api-key YOUR_KEY --server-url https://custom.server
#   curl -fsSL ... | bash -s -- --no-daemon   (install only, don't enable daemon)
#   curl -fsSL ... | bash -s -- --no-boot     (install only, don't enable boot service)

set -euo pipefail

REPO="dbfx/dustforge"
INSTALL_DIR="/opt/dustforge"
BIN_LINK="/usr/local/bin/dustforge"
SERVICE_NAME="dustforge-daemon"

API_KEY=""
SERVER_URL=""
NO_DAEMON=false
NO_BOOT=false
INSTALL_USER="${SUDO_USER:-$USER}"
INSTALL_HOME=$(eval echo "~${INSTALL_USER}")

# ── Parse arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)    API_KEY="$2";    shift 2 ;;
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --no-daemon)  NO_DAEMON=true;  shift ;;
    --no-boot)    NO_BOOT=true;    shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()   { echo -e "\033[1;32m==>\033[0m $*"; }
err()  { echo -e "\033[1;31m==>\033[0m $*" >&2; }

require() {
  if ! command -v "$1" &>/dev/null; then
    err "Required command not found: $1"
    exit 1
  fi
}

# ── Preflight ────────────────────────────────────────────────────
require curl
require jq

if [[ "$(uname -s)" != "Linux" ]]; then
  err "This installer is for Linux only."
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH_LABEL="x64" ;;
  *)       err "Unsupported architecture: $ARCH (only x86_64 is supported)"; exit 1 ;;
esac

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi

# ── Fetch latest release ────────────────────────────────────────
log "Finding latest DustForge release..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
ASSET_NAME="DustForge-${VERSION#v}-${ARCH_LABEL}.AppImage"
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r \
  --arg name "$ASSET_NAME" \
  '.assets[] | select(.name == $name) | .browser_download_url')

if [[ -z "$DOWNLOAD_URL" || "$DOWNLOAD_URL" == "null" ]]; then
  err "Could not find AppImage asset: $ASSET_NAME"
  err "Available assets:"
  echo "$RELEASE_JSON" | jq -r '.assets[].name' >&2
  exit 1
fi

log "Latest version: $VERSION"
log "Downloading $ASSET_NAME..."

# ── Download and install ─────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
APPIMAGE_PATH="${INSTALL_DIR}/DustForge.AppImage"

# Download to temp file first, then move atomically
TMP_FILE=$(mktemp "${INSTALL_DIR}/.dustforge-download.XXXXXX")
trap 'rm -f "$TMP_FILE"' EXIT

curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"
mv -f "$TMP_FILE" "$APPIMAGE_PATH"
trap - EXIT

# Symlink to PATH
ln -sf "$APPIMAGE_PATH" "$BIN_LINK"

ok "Installed DustForge $VERSION to $APPIMAGE_PATH"

# ── Configure API key / server URL ───────────────────────────────
if [[ -n "$API_KEY" ]]; then
  log "Saving API key..."
  "$APPIMAGE_PATH" --no-sandbox --daemon --api-key "$API_KEY" &
  CONFIG_PID=$!
  sleep 3
  kill "$CONFIG_PID" 2>/dev/null || true
  wait "$CONFIG_PID" 2>/dev/null || true
  ok "API key saved."
fi

if [[ -n "$SERVER_URL" ]]; then
  log "Saving server URL..."
  "$APPIMAGE_PATH" --no-sandbox --daemon --server-url "$SERVER_URL" &
  CONFIG_PID=$!
  sleep 3
  kill "$CONFIG_PID" 2>/dev/null || true
  wait "$CONFIG_PID" 2>/dev/null || true
  ok "Server URL saved."
fi

# ── Systemd service for boot ─────────────────────────────────────
if [[ "$NO_BOOT" == false ]] && command -v systemctl &>/dev/null; then
  log "Creating systemd service..."

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=DustForge Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${APPIMAGE_PATH} --no-sandbox --daemon
Restart=on-failure
RestartSec=10
Environment=APPIMAGE=${APPIMAGE_PATH}
Environment=DISPLAY=:0

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  ok "Systemd service created and enabled for boot."

  if [[ "$NO_DAEMON" == false && -n "$API_KEY" ]]; then
    log "Starting daemon..."
    systemctl start "$SERVICE_NAME"
    ok "Daemon started."
  fi
else
  if [[ "$NO_BOOT" == true ]]; then
    log "Skipping boot service (--no-boot)."
  else
    log "systemd not found — skipping boot service."
    log "You can run the daemon manually: dustforge --no-sandbox --daemon"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────
echo ""
ok "DustForge $VERSION installation complete!"
echo ""
echo "  Binary:   $APPIMAGE_PATH"
echo "  Symlink:  $BIN_LINK"
[[ "$NO_BOOT" == false ]] && command -v systemctl &>/dev/null && \
echo "  Service:  systemctl status $SERVICE_NAME"
echo ""
echo "  Run GUI:        dustforge --no-sandbox"
echo "  Run CLI:        dustforge --no-sandbox --cli"
echo "  Run daemon:     dustforge --no-sandbox --daemon"
echo "  Check status:   systemctl status $SERVICE_NAME"
echo "  View logs:      journalctl -u $SERVICE_NAME -f"
echo ""
