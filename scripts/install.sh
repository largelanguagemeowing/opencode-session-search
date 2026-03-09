#!/usr/bin/env bash
set -euo pipefail

REPO="largelanguagemeowing/opencode-session-search"
DEFAULT_VERSION="latest"
VERSION="$DEFAULT_VERSION"
CONFIG_ROOT="${HOME}/.config/opencode"
PLUGIN_DIR="$CONFIG_ROOT/plugins"
PLUGIN_FILE="$PLUGIN_DIR/session-search.js"
PACKAGE_JSON="$CONFIG_ROOT/package.json"
PLUGIN_PACKAGE_NAME="@opencode-ai/plugin"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:?missing version value}"
      shift 2
      ;;
    --dir)
      CONFIG_ROOT="${2:?missing config dir}"
      PLUGIN_DIR="$CONFIG_ROOT/plugins"
      PLUGIN_FILE="$PLUGIN_DIR/session-search.js"
      PACKAGE_JSON="$CONFIG_ROOT/package.json"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: install.sh [--version <tag>] [--dir <opencode-config-dir>]" >&2
      exit 1
      ;;
  esac
done

if command -v curl >/dev/null 2>&1; then
  FETCH_CMD=(curl -fsSL)
elif command -v wget >/dev/null 2>&1; then
  FETCH_CMD=(wget -qO-)
else
  echo "curl or wget is required" >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

resolve_download_url() {
  if [ "$VERSION" = "latest" ]; then
    printf 'https://github.com/%s/releases/latest/download/opencode-session-search-latest.tar.gz\n' "$REPO"
  else
    printf 'https://github.com/%s/releases/download/%s/opencode-session-search-%s.tar.gz\n' "$REPO" "$VERSION" "$VERSION"
  fi
}

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE_URL="$(resolve_download_url)"
ARCHIVE_PATH="$TMP_DIR/opencode-session-search.tar.gz"

echo "Downloading $ARCHIVE_URL"
"${FETCH_CMD[@]}" "$ARCHIVE_URL" > "$ARCHIVE_PATH"

mkdir -p "$PLUGIN_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

EXTRACTED_DIR="$TMP_DIR/opencode-session-search"
if [ ! -d "$EXTRACTED_DIR" ]; then
  echo "archive did not contain opencode-session-search/" >&2
  exit 1
fi

install -m 0644 "$EXTRACTED_DIR/session-search.js" "$PLUGIN_FILE"
if [ -f "$EXTRACTED_DIR/session-search.js.map" ]; then
  install -m 0644 "$EXTRACTED_DIR/session-search.js.map" "$PLUGIN_DIR/session-search.js.map"
fi

node - <<'EOF' "$PACKAGE_JSON" "$PLUGIN_PACKAGE_NAME"
const fs = require("fs")
const path = process.argv[2]
const depName = process.argv[3]

let data = {}
if (fs.existsSync(path)) {
  data = JSON.parse(fs.readFileSync(path, "utf8"))
}

if (!data.dependencies || typeof data.dependencies !== "object") {
  data.dependencies = {}
}

if (!data.dependencies[depName]) {
  data.dependencies[depName] = "^1.0.0"
}

fs.mkdirSync(require("path").dirname(path), { recursive: true })
fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
EOF

echo "Installed local plugin file to $PLUGIN_FILE"
echo "Ensured dependency in $PACKAGE_JSON"
echo "OpenCode should auto-load plugins from $PLUGIN_DIR at startup."
