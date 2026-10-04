# Keeper on the VPS

The keeper runs as one Node 22 process on the owner's Hostinger VPS (D-002, D-036), under systemd, as the `sleeve` user. The
host is shared with other projects: everything here lives in `/opt/sleeve`, the `sleeve` user and two unit files, and
nothing touches another project's containers, files or Node install. These steps were written and checked against
the files in this folder, and the live keeper was installed with them on 4 October 2026. docs/DEPLOYMENTS.md (Keeper
section) records the release and the checks.

| Path on the server | What it is | Owner and mode |
| --- | --- | --- |
| `/opt/sleeve/node` | A private Node 22 runtime, checked against nodejs.org's SHASUMS256.txt | root, 755 |
| `/opt/sleeve/keeper/releases/<release>` | One built release: `dist/main.js`, `dist/keygen.js`, this README | root, 755 |
| `/opt/sleeve/keeper/current` | Symlink to the running release | root |
| `/opt/sleeve/secrets/keeper.env` | The environment (RPC URL, Supabase keys, keeper settings) | root:root, 600 |
| `/opt/sleeve/secrets/keeper.key` | The keeper's private key, one hex key | root:root, 600 |
| `/etc/systemd/system/sleeve-keeper.service` | The keeper | root, 644 |
| `/etc/systemd/system/sleeve-keeper-once.service` | One dry-run pass, started by hand | root, 644 |

The `sleeve` user can read neither secret. systemd reads the env file as root, and `LoadCredential=` hands the
service a private copy of the key in its credentials directory, which is where `KEEPER_PRIVATE_KEY_FILE` points.

## 1. Before the first install

On this machine: the workspace dependencies installed (`pnpm install` at the repo root), `ssh` and `rsync`, and ssh
access to the VPS as root or as a user with passwordless sudo (`sudo -n true` must succeed there).

On the VPS: Ubuntu 24.04 or later (the live host runs 26.04) with `curl`, `tar` with xz support, `rsync` and systemd, all in the base image, and outbound
HTTPS to nodejs.org (once, for the runtime), the QuickNode endpoint and the Supabase project.

The owner decides which key the keeper uses (docs/research/prd-questions.md Q34). The module's default keeper,
immutable, is KEEPER `0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46` (docs/DEPLOYMENTS.md). Accounts installed with the
default keeper are served only by that key. A new key serves only accounts that name it at install or later through
setKeeper. The keeper running on the Hostinger VPS uses the KEEPER key, the module's default (docs/DEPLOYMENTS.md,
Keeper section).

## 2. Install or upgrade

From the repo root, with a clean tree:

```
bash keeper/deploy/install.sh root@<vps>
```

It builds `keeper/dist`, uploads the release, and on the server creates the user and directories, installs the Node
runtime if needed, switches `current` to the new release, keeps the five newest releases, installs and enables the
units, and checks that both secrets exist as `600 root:root`. It starts or restarts the keeper only when they do, then
prints the unit status and the health report. Run it again for every upgrade.

- `--no-start` installs without starting or restarting; a running keeper keeps the release it started with.
- `--build-only` builds and lists the release without connecting to anything.
- `ALLOW_DIRTY=1` allows a build with uncommitted changes in `keeper/` or `packages/core`; otherwise it is refused,
  since the release name carries the commit.
- `NODE_VERSION` overrides the runtime version (default 22.20.0).

## 3. Place the environment file

On the server, create the file empty with the right owner and mode, then open it in an editor. Values typed or pasted
into an editor never reach the shell history.

```
sudo install -m 600 -o root -g root /dev/null /opt/sleeve/secrets/keeper.env
sudo nano /opt/sleeve/secrets/keeper.env
```

Fill it from `keeper.env.example` (in this folder and in every release): `KEEPER_RPC` (the QuickNode endpoint on
Robinhood Chain mainnet, D-032, never the public RPC), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and any setting
to change from its default. Do not set `KEEPER_PRIVATE_KEY_FILE`; the unit sets it, and a value in this file would
win. The root `.env.example` lists `KEEPER_PRIVATE_KEY_FILE` for local runs; leave that line out here.

## 4. Place the keeper key

The key file holds one 32-byte hex private key and nothing else; `0x` and a trailing newline are fine. The files in
`~/.sleeve-keys` already hold keys this way (`scripts/secret-scan.sh` reads them as hex).

Option A, the existing KEEPER key from `~/.sleeve-keys` on this machine. The key travels inside the ssh connection on
standard input. It appears in no command line, so in no shell history and no process list, and it never touches the
repo. Run this here, on this machine, with the name of the KEEPER key file:

```
ssh root@<vps> 'umask 077 && cat > /opt/sleeve/secrets/keeper.key' < ~/.sleeve-keys/<keeper key file>
```

As a sudo user instead of root:

```
ssh <user>@<vps> 'sudo -n sh -c "umask 077 && cat > /opt/sleeve/secrets/keeper.key"' < ~/.sleeve-keys/<keeper key file>
```

Option B, a new key generated on the server, so it never leaves it (Q34's recommendation). The file is created at
mode 600 and never overwritten; only the address is printed:

```
sudo /opt/sleeve/node/bin/node /opt/sleeve/keeper/current/dist/keygen.js /opt/sleeve/secrets/keeper.key
```

Fund the printed address with ETH for gas (docs/FUNDING.md). Remember that this key serves only accounts that name it
as their keeper.

Either way, check the file and the address it gives. The second command reads the key as root and prints only the
address:

```
sudo stat -c '%a %U:%G' /opt/sleeve/secrets/keeper.key
sudo env KEEPER_PRIVATE_KEY_FILE=/opt/sleeve/secrets/keeper.key /opt/sleeve/node/bin/node /opt/sleeve/keeper/current/dist/main.js --print-address
```

The first must print `600 root:root`. The keeper refuses to start with a key file other users can read. The copy
systemd hands the service is 0440 root:root in the unit's 0550 root:root credentials directory, readable by the
`sleeve` user through an ACL, and the keeper accepts exactly that case (`keyFileModeProblem` in src/keyfile.ts).

## 5. Dry run, then start

One pass that indexes, decides and simulates with the production environment, and never signs or sends:

```
sudo systemctl start sleeve-keeper-once
journalctl -u sleeve-keeper-once -n 50 --no-pager
```

Each decision is a JSON line with its block number; `dry run: would send` names every transaction the keeper would
have sent, and the last line is the health report. A dry run writes the same index rows the live keeper would, and
its keeper_runs rows are SKIPPED with `dryRun` in their detail. The first pass after an empty database indexes from
the deploy block, 79,338,287, in ranges the RPC accepts, so it can take a while.

Then start the keeper (or rerun `install.sh`, which starts it once the secrets are in place):

```
sudo systemctl restart sleeve-keeper
systemctl status sleeve-keeper --no-pager
journalctl -u sleeve-keeper -f
curl -s http://127.0.0.1:8787/health
```

`/health` answers 200 when the keeper is current and 503 with the same JSON when it is starting, lagging behind the
head by more than `KEEPER_MAX_LAG_SECONDS`, stalled (no finished pass for three minutes or twelve polls, whichever is longer), or halted by a reorg
below its cursor. It reports the last indexed block, the chain head, the lag, the accounts served, the last action,
the keeper address and its ETH balance, open alerts and the version.

The health port listens on the loopback interface only. Check it:

```
sudo ss -ltnp | grep 8787
```

The line must show `127.0.0.1:8787` and nothing else for that port.

## 6. Alerts

Alerts are log lines with an `alert` field and entries in `/health` under `alerts`:

| Alert | Meaning | What to do |
| --- | --- | --- |
| `LOW_BALANCE` | The keeper address holds less than `KEEPER_MIN_BALANCE_ETH` | Send ETH to the keeper address |
| `CALENDAR_COVERAGE` | The session calendar ends within 30 days (audit A1-36) | Schedule `appendYear` through the timelock now; it takes 48 hours |
| `CALENDAR_EXPIRED` | The calendar has ended: every split queues SESSION | Append the year; until then SESSION waits mean the calendar expired |
| `UNEXPECTED_DECIMALS` | A token or feed reports decimals other than 18 or 8 | That ticker is not traded until it is fixed; tell the owner |
| `REORG_BELOW_CURSOR` | A block the index holds changed on chain | Indexing stops (splits and settles go on). The index is append-only: rebuild it into an empty database |

## 7. Roll back, rotate, remove

Roll back to an earlier release:

```
ls -1t /opt/sleeve/keeper/releases
sudo ln -sfn releases/<release> /opt/sleeve/keeper/current.new && sudo mv -Tf /opt/sleeve/keeper/current.new /opt/sleeve/keeper/current
sudo systemctl restart sleeve-keeper
```

If the keeper key leaks, it can trigger split and settle without the grace on every account that names it, bounded
by each rule's premium cap (audit A1-22). Generate a new key (option B), fund it, have the app append `setKeeper(new)`
to each affected account's next owner op, and move the old key's ETH out.

Remove everything the keeper added:

```
sudo systemctl disable --now sleeve-keeper
sudo rm -f /etc/systemd/system/sleeve-keeper.service /etc/systemd/system/sleeve-keeper-once.service
sudo systemctl daemon-reload
sudo rm -rf /opt/sleeve
sudo userdel sleeve
```
