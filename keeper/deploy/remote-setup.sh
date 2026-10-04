#!/usr/bin/env bash
# Runs on the VPS as root, from keeper/deploy/install.sh. Idempotent:
#   - the sleeve system user (no login shell) and /opt/sleeve/{keeper,secrets,node}
#   - a private Node runtime under /opt/sleeve/node, checked against nodejs.org's SHASUMS256.txt, so nothing changes
#     for the other projects on this host
#   - the release under /opt/sleeve/keeper/releases/<release>, with /opt/sleeve/keeper/current pointing at it
#   - the systemd units, enabled
#   - the secrets checked by owner and mode only, never read aloud; the service starts only when they are in place
set -euo pipefail

UPLOAD="$1"
RELEASE="$2"
NODE_VERSION="$3"
START="${4:-start}"

BASE=/opt/sleeve
SECRETS="$BASE/secrets"
KEEPER="$BASE/keeper"
UNIT_DIR=/etc/systemd/system

if [ "$(id -u)" -ne 0 ]; then
  echo "remote-setup.sh: run as root" >&2
  exit 1
fi
umask 022

echo "--> user and directories"
if ! id sleeve >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin sleeve
fi
install -d -m 755 -o root -g root "$BASE" "$KEEPER" "$KEEPER/releases"
install -d -m 700 -o root -g root "$SECRETS"

echo "--> node v$NODE_VERSION"
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) echo "remote-setup.sh: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
NODE_DIR="$BASE/node-v$NODE_VERSION-linux-$ARCH"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  WORK="$(mktemp -d)"
  TARBALL="node-v$NODE_VERSION-linux-$ARCH.tar.xz"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/$TARBALL" "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$WORK" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
  install -d -m 755 "$NODE_DIR"
  tar -xJf "$WORK/$TARBALL" -C "$NODE_DIR" --strip-components=1 --no-same-owner
  rm -rf "$WORK"
fi
ln -sfn "$NODE_DIR" "$BASE/node"
"$BASE/node/bin/node" --version

echo "--> release $RELEASE"
TARGET="$KEEPER/releases/$RELEASE"
rm -rf "$TARGET"
cp -R "$UPLOAD/release" "$TARGET"
chown -R root:root "$TARGET"
chmod -R u=rwX,go=rX "$TARGET"
ln -sfn "releases/$RELEASE" "$KEEPER/current.new"
mv -Tf "$KEEPER/current.new" "$KEEPER/current"
# Keep the five newest releases for a rollback.
ls -1dt "$KEEPER"/releases/*/ | tail -n +6 | xargs -r rm -rf

echo "--> systemd units"
install -m 644 -o root -g root "$UPLOAD/sleeve-keeper.service" "$UNIT_DIR/sleeve-keeper.service"
install -m 644 -o root -g root "$UPLOAD/sleeve-keeper-once.service" "$UNIT_DIR/sleeve-keeper-once.service"
systemctl daemon-reload
systemctl enable sleeve-keeper.service >/dev/null

echo "--> secrets"
ready=1
for file in keeper.env keeper.key; do
  path="$SECRETS/$file"
  if [ ! -f "$path" ]; then
    echo "    missing: $path"
    ready=0
    continue
  fi
  mode="$(stat -c '%a %U:%G' "$path")"
  if [ "$mode" != "600 root:root" ]; then
    echo "    $path is $mode; it must be 600 root:root (chown root:root and chmod 600 it)"
    ready=0
  fi
done
if [ -f "$SECRETS/keeper.env" ] && grep -q '^[[:space:]]*KEEPER_PRIVATE_KEY_FILE=' "$SECRETS/keeper.env"; then
  echo "    $SECRETS/keeper.env sets KEEPER_PRIVATE_KEY_FILE; remove that line, the unit sets it"
  ready=0
fi

if [ "$ready" -ne 1 ]; then
  echo "--> not started: place the secrets as keeper/deploy/README.md describes, then run: systemctl restart sleeve-keeper"
  exit 0
fi
if [ "$START" != "start" ]; then
  echo "--> installed, not started (--no-start)"
  exit 0
fi

echo "--> starting"
systemctl restart sleeve-keeper.service
PORT="$(sed -n 's/^[[:space:]]*KEEPER_HEALTH_PORT=\([0-9]\{1,5\}\)[[:space:]]*$/\1/p' "$SECRETS/keeper.env" | tail -n 1)"
PORT="${PORT:-8787}"
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  if ! systemctl is-active --quiet sleeve-keeper.service; then break; fi
  sleep 2
done
systemctl --no-pager --lines=0 status sleeve-keeper.service || true
echo "--> health"
curl -sS "http://127.0.0.1:$PORT/health" || echo "    no answer yet; follow the log: journalctl -u sleeve-keeper -f"
echo
