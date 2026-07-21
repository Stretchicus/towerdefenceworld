# Deploying Tower Defence World (Apache + Node)

## Architecture

- **Node** (`@tdw/server`) on `127.0.0.1:3101` — health + WebSocket `/ws`
- **Static client** = contents of `packages/client/dist/` (Vite build)
- **Apache** serves that folder and reverse-proxies `/ws` → Node

Header shows **build `v0.1.2`** (or newer). If you do not see that version string, the browser is still on an old client.

---

## Correct deploy (use this)

Do **not** copy only `packages/` from Windows. That skips root workspace files and often leaves you building/serving a mix of old and new code.

### 1. Full repo on the server via git

```bash
cd /var/www/html/towerdefenceworld
git fetch origin
git checkout main
git pull origin main
git log -1 --oneline    # confirm you have the latest commit
```

If this directory is **not** a git clone, fix that once:

```bash
cd /var/www/html
# backup your old folder first if needed
git clone https://github.com/Stretchicus/towerdefenceworld.git
cd towerdefenceworld
```

### 2. Clean install + build everything on Linux

```bash
cd /var/www/html/towerdefenceworld
rm -rf node_modules packages/*/node_modules
npm install
npm run build -w @tdw/game-core
npm run build -w @tdw/server
npm run build -w @tdw/client
```

### 3. Point the website at the new client (pick ONE approach)

**A — Recommended:** set Apache `DocumentRoot` to the build output itself:

```apache
DocumentRoot /var/www/html/towerdefenceworld/packages/client/dist
```

Then you never hand-copy files. After each build, only restart Apache if config changed (usually not needed).

**B — Copy into a separate web root** (must replace *all* files, including `index.html`):

```bash
# example: DocumentRoot /var/www/html  or /var/www/tdw
rsync -a --delete \
  /var/www/html/towerdefenceworld/packages/client/dist/ \
  /var/www/html/
```

`--delete` removes old hashed JS/CSS so you cannot keep serving yesterday’s bundle.

### 4. Restart the game server

```bash
sudo systemctl restart tdw
sudo systemctl status tdw --no-pager
curl -s http://127.0.0.1:3101/health
# expect: {"ok":true}
```

### 5. Prove the browser got the new client

1. Hard refresh: Ctrl+Shift+R (or incognito).
2. Top bar must show **`v0.1.2`** (or higher) next to the status.
3. Create/join a room → **Leave room** appears top-right.
4. In combat: gold route tubes + cyan tower pads + **Build tower** list on the right.

If health is ok but the UI has no `v0.1.2`, Apache is serving the **wrong directory** or a cached old `index.html`.

Check which files Apache actually serves:

```bash
# adjust path to YOUR DocumentRoot
grep -R "assets/" -n /var/www/html/index.html | head
ls -lt /var/www/html/assets/ | head
# timestamps should be from your latest build
```

---

## What you were doing wrong

| Step | Problem |
|------|---------|
| Copy only `packages/` from Windows | Root `package.json` / lockfile / scripts can be stale; easy to miss files |
| Assume outer JSONs unchanged | They **do** change (ports, build scripts, workspaces) |
| Copy `client/dist` without `--delete` | Old `assets/index-XXXX.js` can linger; browser may keep old bundles |
| Wrong DocumentRoot | Updating `/var/www/html/towerdefenceworld/...` while Apache serves `/var/www/html` or `/var/www/tdw` |
| Soft refresh only | Cached `index.html` points at old hashed JS |

---

## systemd

`/etc/systemd/system/tdw.service`:

```ini
[Unit]
Description=Tower Defence World
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/html/towerdefenceworld/packages/server
Environment=PORT=3101
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tdw
```

## Apache (example)

```apache
<VirtualHost *:80>
  ServerName your.domain.or.ip
  DocumentRoot /var/www/html/towerdefenceworld/packages/client/dist

  <Directory /var/www/html/towerdefenceworld/packages/client/dist>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
    FallbackResource /index.html
  </Directory>

  # Avoid sticky HTML cache while iterating
  <Files "index.html">
    Header set Cache-Control "no-cache"
  </Files>

  ProxyPreserveHost On
  ProxyPass /health http://127.0.0.1:3101/health
  ProxyPassReverse /health http://127.0.0.1:3101/health
  ProxyPass /ws ws://127.0.0.1:3101/ws
  ProxyPassReverse /ws ws://127.0.0.1:3101/ws
</VirtualHost>
```

Enable: `proxy`, `proxy_http`, `proxy_wstunnel`, `headers`.

## Troubleshooting: `tsc: Permission denied`

```bash
rm -rf node_modules packages/*/node_modules
npm install
```

Never copy `node_modules` from Windows.

## Leave button note

**Leave room** only shows after you have joined/created a room (lobby or match). On the bare Create/Join screen there is nothing to leave yet.

## Known ops notes

- Rooms are in-memory; restarting `tdw` drops active matches
- No MySQL required for v1
