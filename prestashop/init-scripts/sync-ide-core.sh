#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PRESTASHOP_DIR="$ROOT_DIR/prestashop"
TARGET_DIR="$PRESTASHOP_DIR/ide-core/prestashop-core"

mkdir -p "$TARGET_DIR"

CID="$(docker compose -f "$PRESTASHOP_DIR/docker-compose.yml" ps -q prestashop)"
if [ -z "$CID" ]; then
  echo "prestashop container is not running. Start it first with:"
  echo "docker compose -f \"$PRESTASHOP_DIR/docker-compose.yml\" up prestashop -d"
  exit 1
fi

rm -rf "$TARGET_DIR/classes" "$TARGET_DIR/src" "$TARGET_DIR/config"
docker cp "$CID:/var/www/html/classes" "$TARGET_DIR/"
docker cp "$CID:/var/www/html/src" "$TARGET_DIR/"
docker cp "$CID:/var/www/html/config" "$TARGET_DIR/"

echo "PrestaShop IDE core synced to $TARGET_DIR"
