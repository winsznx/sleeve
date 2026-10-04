#!/usr/bin/env bash
# Builds the keeper release on this machine and installs it on the VPS over ssh.
#
#   bash keeper/deploy/install.sh root@<host>          build, upload, install, start if the secrets are in place
#   bash keeper/deploy/install.sh root@<host> --no-start
#   bash keeper/deploy/install.sh --build-only          build and stage locally, connect to nothing
#
# The host must be reachable by ssh as root or as a user with passwordless sudo. The script touches only
# /opt/sleeve, the sleeve user and /etc/systemd/system/sleeve-keeper*.service on the server. It never reads, prints or
# copies a secret: the key and the env file are placed by hand (keeper/deploy/README.md) and checked by mode only.
set -euo pipefail

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

HOST=""
BUILD_ONLY=0
START=start
for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    --no-start) START=no-start ;;
    -h | --help) usage ;;
    -*) echo "install.sh: unknown option $arg" >&2; usage ;;
    *)
      if [ -n "$HOST" ]; then echo "install.sh: one host only" >&2; usage; fi
      HOST="$arg"
      ;;
  esac
done
if [ "$BUILD_ONLY" -eq 0 ] && [ -z "$HOST" ]; then usage; fi

# Node 22 LTS for the server, verified against nodejs.org's SHASUMS256.txt on the server before use.
NODE_VERSION="${NODE_VERSION:-22.20.0}"

KEEPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$KEEPER_DIR/.." && pwd)"

echo "==> building the keeper bundle"
(cd "$REPO_ROOT" && pnpm --filter @sleeve/keeper build)
VERSION="$(cat "$KEEPER_DIR/dist/VERSION")"
case "$VERSION" in
  *.dirty)
    if [ "${ALLOW_DIRTY:-0}" != "1" ]; then
      echo "install.sh: the build $VERSION has uncommitted changes in keeper/ or packages/core; commit first or set ALLOW_DIRTY=1" >&2
      exit 1
    fi
    ;;
esac
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-${VERSION#*+}"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/sleeve-keeper-release.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/release/dist"
cp "$KEEPER_DIR"/dist/main.js "$KEEPER_DIR"/dist/main.js.map "$KEEPER_DIR"/dist/keygen.js "$KEEPER_DIR"/dist/keygen.js.map \
  "$KEEPER_DIR"/dist/package.json "$KEEPER_DIR"/dist/VERSION "$STAGE/release/dist/"
cp "$KEEPER_DIR/deploy/README.md" "$KEEPER_DIR/deploy/keeper.env.example" "$STAGE/release/"
cp "$KEEPER_DIR/deploy/sleeve-keeper.service" "$KEEPER_DIR/deploy/sleeve-keeper-once.service" \
  "$KEEPER_DIR/deploy/remote-setup.sh" "$STAGE/"
echo "==> staged release $RELEASE ($VERSION)"

if [ "$BUILD_ONLY" -eq 1 ]; then
  (cd "$STAGE" && find . -type f | sort)
  echo "==> build only: nothing was sent"
  exit 0
fi

# Root logs in directly; any other user needs passwordless sudo.
SUDO="sudo -n"
if [ "${HOST%%@*}" = "root" ]; then SUDO=""; fi

UPLOAD="/tmp/sleeve-keeper-upload-$RELEASE"
echo "==> uploading to $HOST:$UPLOAD"
ssh -o BatchMode=yes "$HOST" "rm -rf '$UPLOAD' && mkdir -m 700 '$UPLOAD'"
rsync -az --delete -e "ssh -o BatchMode=yes" "$STAGE/" "$HOST:$UPLOAD/"

echo "==> installing on $HOST"
ssh -o BatchMode=yes "$HOST" "$SUDO bash '$UPLOAD/remote-setup.sh' '$UPLOAD' '$RELEASE' '$NODE_VERSION' '$START'; status=\$?; rm -rf '$UPLOAD'; exit \$status"
