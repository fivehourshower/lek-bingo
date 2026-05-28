# Lek finals bingo — server

A collaborative bingo room. Single Node process: serves the static frontend and
relays game state over a WebSocket. State is held in memory and persisted to a
SQLite database on every change. Designed to drop onto a Digital Ocean droplet (or any
Docker host) and stay up.

## Running locally

```sh
cd server
npm install
node server.js
# → open http://localhost:3000
```

Environment variables (all optional):

| Var | Default | What |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WS port |
| `ADMIN_PASSWORD` | `nanohope` | Password to unlock the admin panel |
| `STATE_DB_FILE` | `./data/state.sqlite` | Where in-memory state is persisted on every change |
| `STATE_FILE` | `./data/state.json` | Optional legacy JSON source used once for migration into SQLite |
| `WORDS_FILE` | `./bingo_words.json` | The word list. Read on boot; rewritten when admin saves via UI |

## Running with Docker

```sh
cd server
docker compose up -d --build
# → http://<host>:3000
```

The compose file mounts:
- `./bingo_words.json` → `/app/bingo_words.json`  (edit on disk, restart, takes effect)
- a named volume `bingo-data` → `/app/data`        (state survives container restart)

Change the admin password by exporting `ADMIN_PASSWORD=…` before `docker compose up`,
or by editing the compose file.

## Deploying to a Digital Ocean droplet

1. Spin up a droplet (Ubuntu 22.04, $4/mo tier is more than enough).
2. SSH in and install Docker + Compose plugin:
   ```sh
   curl -fsSL https://get.docker.com | sh
   apt-get install -y docker-compose-plugin
   ```
3. Copy this `server/` folder up (`scp -r server root@droplet:/opt/bingo`) or
   `git clone` your fork.
4. `cd /opt/bingo && ADMIN_PASSWORD=<your-password> docker compose up -d --build`
5. Point a domain at the droplet IP and either:
   - expose port 3000 directly, or
   - put Nginx/Caddy in front for HTTPS (recommended). Example Caddy block:
     ```
     bingo.example.com {
       reverse_proxy 127.0.0.1:3000
     }
     ```
     Caddy handles WebSocket upgrades automatically.

## Editing the word list

Two ways:

1. **From the admin panel.** Sign in to `/`, hit "Admin sign-in", paste a JSON of
   shape `{ "center_square": null | "FREE" | "<word>", "words": ["…", …] }`,
   click "Save words". The server rewrites `bingo_words.json` on disk and pushes
   the new pool to every connected client.
2. **On disk.** Edit `bingo_words.json` directly and restart the container. The
   server re-reads the file on boot.

`center_square: null` picks a random word for the center per dealt board.

## Architecture

- **`server.js`** — Express static + `ws` WebSocket server. Single global state.
  All actions are simple methods on a `state` object; after each one the server
  broadcasts the full state to every connected socket. Presence is derived from
  the set of open WS connections, not stored.
- **`state.js`** — actions + SQLite persistence (debounced 250ms).
- **`public/`** — vanilla React app served as-is, transpiled in the browser via
  Babel Standalone. No build step. Same components as the design prototype; only
  `store.jsx` differs (WebSocket-backed instead of localStorage).
- Broadcast banners default to session-only and can optionally persist for 1, 5,
  10, or 30 minutes, or forever.

## Limits / notes

- Single room. If you want multiple concurrent games, run multiple containers on
  different ports/subdomains.
- In-memory + SQLite snapshot persistence.
- No rate-limiting on WS messages. For a public-internet deployment behind a
  reverse proxy, the proxy can shoulder that.
- The admin password is the only auth. Don't reuse it with anything sensitive.
