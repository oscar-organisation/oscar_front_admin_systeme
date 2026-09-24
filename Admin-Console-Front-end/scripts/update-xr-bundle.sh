#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRONTEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
XR_SOURCE=${1:-"$FRONTEND_DIR/../../oscar_front_casque_vr_ar"}
XR_TARGET="$FRONTEND_DIR/public/xr"

if [ ! -f "$XR_SOURCE/package.json" ] || [ ! -d "$XR_SOURCE/.git" ]; then
  echo "Le dépôt WebXR est introuvable : $XR_SOURCE" >&2
  exit 1
fi

XR_REVISION=$(git -C "$XR_SOURCE" rev-parse HEAD)
XR_REPOSITORY=$(git -C "$XR_SOURCE" remote get-url origin)

npm --prefix "$XR_SOURCE" ci
npm --prefix "$XR_SOURCE" run build -- --base=/xr/

if [ ! -f "$XR_SOURCE/dist/index.html" ] || ! grep -q '/xr/assets/' "$XR_SOURCE/dist/index.html"; then
  echo "Le build WebXR n'est pas configuré pour la base /xr/." >&2
  exit 1
fi

mkdir -p "$XR_TARGET"
find "$XR_TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R "$XR_SOURCE/dist/." "$XR_TARGET/"
{
  printf 'repository=%s\n' "$XR_REPOSITORY"
  printf 'revision=%s\n' "$XR_REVISION"
} > "$XR_TARGET/.source-revision"

echo "Cockpit WebXR $XR_REVISION copié dans $XR_TARGET"
