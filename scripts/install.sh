#!/usr/bin/env bash
set -euo pipefail

REPO="largelanguagemeowing/opencode-session-search"
DEFAULT_VERSION="latest"
VERSION="$DEFAULT_VERSION"
INSTALL_ROOT="${HOME}/.config/opencode/plugins/session-search"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:?missing version value}"
      shift 2
      ;;
    --dir)
      INSTALL_ROOT="${2:?missing install dir}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: install.sh [--version <tag>] [--dir <install-dir>]" >&2
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

rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

EXTRACTED_DIR="$TMP_DIR/opencode-session-search"
if [ ! -d "$EXTRACTED_DIR" ]; then
  echo "archive did not contain opencode-session-search/" >&2
  exit 1
fi

cp -R "$EXTRACTED_DIR/." "$INSTALL_ROOT/"

PLUGIN_PATH="file://$INSTALL_ROOT/dist/index.js"

echo "Installed to $INSTALL_ROOT"
echo "Add this to your OpenCode config plugin list:"
echo "$PLUGIN_PATH"
