#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="$ROOT_DIR/package.json"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE_JSON")"
NAME="opencode-session-search"
ARTIFACT_DIR="$ROOT_DIR/releases"
STAGE_DIR="$ARTIFACT_DIR/$NAME"
ARCHIVE_PATH="$ARTIFACT_DIR/$NAME-v$VERSION.tar.gz"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/dist"
mkdir -p "$ARTIFACT_DIR"

echo "Building plugin..."
npm run build

cp "$ROOT_DIR/dist/index.js" "$STAGE_DIR/dist/index.js"
cp "$ROOT_DIR/dist/index.d.ts" "$STAGE_DIR/dist/index.d.ts"
cp "$ROOT_DIR/dist/index.js" "$STAGE_DIR/session-search.js"

if [ -f "$ROOT_DIR/dist/index.js.map" ]; then
  cp "$ROOT_DIR/dist/index.js.map" "$STAGE_DIR/dist/index.js.map"
  cp "$ROOT_DIR/dist/index.js.map" "$STAGE_DIR/session-search.js.map"
fi

cp "$ROOT_DIR/README.md" "$STAGE_DIR/README.md"
cp "$ROOT_DIR/LICENSE" "$STAGE_DIR/LICENSE"
cp "$ROOT_DIR/scripts/install.sh" "$STAGE_DIR/install.sh"

chmod +x "$STAGE_DIR/install.sh"

tar -C "$ARTIFACT_DIR" -czf "$ARCHIVE_PATH" "$NAME"

echo "Created $ARCHIVE_PATH"
