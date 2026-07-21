# Deploying Tower Defence World (Apache + Node)

## Architecture

- **Node** (`@tdw/server`) listens on `127.0.0.1:3001` — HTTP health + WebSocket `/ws`
- **Vite build** of `@tdw/client` is static files (e.g. `/var/www/tdw/`)
- **Apache** serves static files and reverse-proxies `/ws` to Node

## Build on the server

```bash
cd /path/to/towerdefenceworld
npm install
npm run build -w @tdw/game-core
npm run build -w @tdw/server
npm run build -w @tdw/client
```

Copy `packages/client/dist/*` to your web root.

## Run Node (systemd example)

`/etc/systemd/system/tdw.service`:

```ini
[Unit]
Description=Tower Defence World
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/towerdefenceworld/packages/server
Environment=PORT=3001
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tdw
```

## Apache vhost snippet

Enable modules: `proxy`, `proxy_http`, `proxy_wstunnel`, `headers`.

```apache
<VirtualHost *:80>
  ServerName tdw.example.com
  DocumentRoot /var/www/tdw

  <Directory /var/www/tdw>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
    FallbackResource /index.html
  </Directory>

  ProxyPreserveHost On
  ProxyPass /health http://127.0.0.1:3001/health
  ProxyPassReverse /health http://127.0.0.1:3001/health

  ProxyPass /ws ws://127.0.0.1:3001/ws
  ProxyPassReverse /ws ws://127.0.0.1:3001/ws
</VirtualHost>
```

For HTTPS, terminate TLS on Apache and use the same `/ws` proxy (browser will use `wss://`).

## Local smoke checklist (2 browsers)

1. `npm install && npm test && npm run build -w @tdw/game-core`
2. Terminal A: `npm run dev:server` (or `npm run start -w @tdw/server` after build)
3. Terminal B: `npm run dev:client`
4. Open http://localhost:5173 — **Create match**
5. Copy room link into a second browser / incognito — **Join**
6. Host: Fill AI if needed → Start
7. Confirm planet renders, phase 1 (auto) enters combat, banks tick, bods spawn
8. Click a tower-point cell to build; toggle Targets / Bods
9. Optional: set win rule Timed with short duration in lobby before start

## Known ops notes

- Rooms are in-memory; Node restart drops active matches
- No MySQL required for v1
