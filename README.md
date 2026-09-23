# Discord Server Bot

A Discord bot that monitors Counter-Strike: Global Offensive (and other supported) servers,
keeps a channel message in sync with their status, and DMs users when a followed map appears.

![Version](https://img.shields.io/badge/version-8.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D24-blue)
![Docker](https://img.shields.io/badge/docker-ready-blue)

## Features

- **Server monitoring**: queries every configured server on one interval and keeps a single
  message in a channel of your choosing updated with a rich embed of their status, posting that
  message itself the first time
- **Map notifications**: DMs everyone following a map when it appears on a server, falling back
  to a configured channel for recipients whose DMs are closed
- **Slash commands**: all interaction is through slash commands, rate limited per user
- **Automatic cleanup**: a member's follows are removed when they leave the guild (needs the
  privileged Server Members Intent, see [Discord Application](#discord-application))
- **Resilient**: game-server queries and Discord calls retry with exponential backoff and
  jitter, while permanent failures are reported once with a remediation hint instead of being
  retried forever

## Commands

### Public Commands

| Command | Description |
|---------|-------------|
| `/players` | Display currently connected players on a specified server |
| `/keywords` | List all available server keywords for searching |
| `/follow` | Follow a map to receive DM notifications when it appears on a server |
| `/unfollow` | Stop following a specific map or all maps |
| `/listfollows` | Display all maps you are currently following |
| `/help` | Show a list of all available commands. Lists the administrator commands only for those authorized to run them |
| `/ping` | Check bot latency |

### Administrator Commands

| Command | Description |
|---------|-------------|
| `/listallfollows` | List all users and their followed maps |
| `/testnotify <map>` | DM yourself a sample notification for a map |
| `/removeuser <userID>` | Remove all map follows for a specific user |

The bot accepts these from a holder of `ADMIN_ROLE_ID`, from anyone with the Discord
**Administrator** permission, and from the guild owner. Discord itself only shows them to the
latter two, so a role holder who is not an Administrator has to be given visibility separately:
either grant the role the Administrator permission, or add a channel or server permission
override for the commands under **Server Settings -> Integrations**. Until then the commands
work but do not appear in their picker. All replies are ephemeral.

## Requirements

- **Node.js** v24 or newer, or **Docker**
- A **Discord application** with the `bot` and `applications.commands` OAuth2 scopes

### Discord Application

- **One guild per instance**: the bot serves the guild in `DISCORD_GUILD_ID` and leaves any
  other guild it is added to, since its admin commands act on the whole database rather than
  on one guild. Turning **Public Bot** off under Bot in the
  [Discord Developer Portal](https://discord.com/developers/applications) stops anyone else
  adding it in the first place.

- **Permissions**, in the `EMBED_CHANNEL_ID` channel and in the fallback channel:
  - View Channel, Send Messages and Embed Links, in both
  - Read Message History, in the `EMBED_CHANNEL_ID` channel, to re-fetch the server list message
    it is editing

  DMs to followers need no permission.

- **Intents**: Guilds, plus GuildMembers, which is privileged. Enable **Server Members Intent**
  under Bot → Privileged Gateway Intents in the
  [Discord Developer Portal](https://discord.com/developers/applications) before starting the
  bot, otherwise login fails with `Used disallowed intents`. It powers the follow cleanup
  above, scoped to `DISCORD_GUILD_ID`.

## Setup

Both ways to run the bot use the same two configuration files, neither of which is tracked in
git.

1. **Clone the repository**

   ```bash
   git clone https://github.com/Sneaks-Community/discordserverbot.git
   cd discordserverbot
   ```

2. **Create the configuration files from their examples**

   ```bash
   cp .env.example .env
   cp servers.json.example servers.json
   ```

3. **Create a channel for the server list**, if you want one. Enable **Developer Mode** under
   User Settings → Advanced, then right-click the channel and **Copy Channel ID**. That ID goes
   in `EMBED_CHANNEL_ID`. The bot posts its own message there and keeps editing it, so there is
   nothing else to create; give it a channel of its own and nobody has to scroll past chat to
   see the servers.

4. **Edit both files.** `.env` needs at least `DISCORD_TOKEN` (see
   [Environment Variables](#environment-variables)), and `servers.json` needs your game servers
   (see [Server Configuration](#server-configuration)).

### Run with Node

```bash
npm install
npm start
```

### Run with Docker

`docker-compose.yml` pulls the published image, bind-mounts `servers.json` and keeps the
database in a named volume, so both files from [Setup](#setup) must exist before the container
starts.

```bash
docker compose up -d      # pull and start
docker compose logs -f    # follow the logs
```

The image is a multi-stage `node:24-alpine` build, roughly 100MB, published to
`ghcr.io/sneaks-community/discordserverbot`. To run it without Compose:

```bash
docker run -d \
  --name discordserverbot \
  --env-file .env \
  -e DATABASE_PATH=/app/data/db.sqlite \
  -v $(pwd)/servers.json:/app/servers.json:ro \
  -v discordserverbot-data:/app/data \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  ghcr.io/sneaks-community/discordserverbot:latest
```

To build it yourself instead, `docker build -t discordserverbot .` and use that tag in place of
the registry one.

Follows are the only state on disk, and they live in the SQLite file at `DATABASE_PATH`, so it
has to resolve inside the `discordserverbot-data` volume mounted at `/app/data`. Under `docker run` above,
anywhere else is the container's writable layer, which is discarded whenever the container is
recreated; under Compose it fails outright, because `docker-compose.yml` sets
`read_only: true` and the only writable path is the volume. The image and
`docker-compose.yml` both default it correctly, but an uncommented `DATABASE_PATH` in
`.env` would override that through `--env-file`, which is why the `docker run` above passes it
explicitly: an explicit `-e` wins.


### Updating

```bash
git pull
npm install                            # Node
docker compose pull && docker compose up -d   # Docker
```

## Backups

Follows and the tracked embed message are the only state on disk. The database runs in WAL mode,
so copying `db.sqlite` with `cp` can capture a stale or torn snapshot. Use SQLite's online
backup, which is safe while the bot is running:

```bash
# Docker: sqlite3 is in the image, /tmp is writable tmpfs and clears on restart
docker compose exec discordserverbot sqlite3 /app/data/db.sqlite ".backup /tmp/db.bak"
docker compose cp discordserverbot:/tmp/db.bak "db-$(date +%F).sqlite"

# Node
sqlite3 db.sqlite ".backup db-$(date +%F).sqlite"
```

The file holds one row per follow, so it stays small; a nightly cron keeping 30 days costs a few
megabytes. To restore:

```bash
docker compose stop
docker compose cp db-2026-08-26.sqlite discordserverbot:/app/data/db.sqlite
docker compose start
```

A clean stop checkpoints the WAL and leaves no sidecar files. If the bot was killed instead,
delete the stale ones first, or they will be replayed over the restored file:

```bash
docker compose run --rm --entrypoint sh discordserverbot -c 'rm -f /app/data/db.sqlite-wal /app/data/db.sqlite-shm'
```

Under Node, stop the bot and replace `db.sqlite` (and any `-wal`/`-shm` beside it) directly.

## Environment Variables

Every value is validated at startup. A malformed or out-of-range one aborts startup with a
message naming the variable and its accepted range rather than being silently corrected, so the
bot never runs half configured. Leaving a variable unset, or setting it to an empty string,
selects its default.

| Variable | Required | Default | Valid range | Description |
|----------|----------|---------|-------------|-------------|
| `DISCORD_TOKEN` | Yes | - | non-empty | Your Discord bot token |
| `DISCORD_GUILD_ID` | Yes | - | snowflake | The one guild this instance serves. Slash commands are registered there, and the bot leaves any other guild it is added to |
| `ADMIN_ROLE_ID` | Recommended | - | snowflake or empty | Role granting access to the [admin commands](#administrator-commands). Empty leaves them to Discord Administrators and the guild owner |
| `BOT_ACTIVITY_TEXT` | No | `/follow <map> for map change alerts` | up to 128 characters, or empty | Activity text shown under the bot's name. Empty shows no activity. Sent with the gateway identify, so it survives reconnects |
| `BOT_ACTIVITY_TYPE` | No | `custom` | `custom`, `playing`, `listening`, `watching`, `competing` | How `BOT_ACTIVITY_TEXT` renders. `custom` shows it verbatim; the others have their verb prepended by Discord (`Playing ...`, `Listening to ...`) |
| `LOG_LEVEL` | No | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | stdout verbosity. An unrecognized value falls back to `info` with a warning rather than aborting, since logging is how problems get reported |
| `FALLBACK_CHANNEL_ID` | No | - | snowflake or empty | Channel used when a DM cannot be delivered. Must be in `DISCORD_GUILD_ID`. Empty disables fallback notifications |
| `EMBED_CHANNEL_ID` | No | - | snowflake or empty | Channel the bot keeps the server list in. It posts one message there on its first update and edits that message from then on, remembering which one in the database. Give it a dedicated channel. Empty disables the server list |
| `EMBED_COLOR` | No | `#79C4D0` | Six hex digits, `#` optional | Embed color as a hex color |
| `DATABASE_PATH` | No | `db.sqlite` | non-empty | SQLite file path. In Docker it must stay on the mounted volume (`/app/data/db.sqlite`, the image default) |
| `SERVER_UPDATE_INTERVAL` | No | `90` | 30 to 86400 | How often the bot queries the servers, updates the embeds and checks for map changes, in that order, on one timer (seconds). The embed states this interval in its description |
| `MAX_CONCURRENT_QUERIES` | No | `10` | 1 to 100 | Maximum concurrent server queries |
| `USER_CACHE_TTL` | No | `300` | 1 to 86400 | User cache TTL (seconds) |
| `RETRY_MAX_RETRIES` | No | `3` | 1 to 10 | Attempts for a retried Discord operation. At least 1, since 0 would mean never attempting it |
| `RETRY_BASE_DELAY` | No | `1` | 0 to 60 | Base delay for exponential backoff (seconds) |
| `GAMEDIG_MAX_RETRIES` | No | `4` | 0 to 10 | Maximum retries for GameDig queries. A multiplier over the ports GameDig tries, so raising it multiplies what an unreachable server costs. A refresh pass is capped at 80% of `SERVER_UPDATE_INTERVAL` regardless, and servers not reached by then are reported offline for that tick |
| `FALLBACK_AVATAR_URL` | No | `https://i.imgur.com/cBiDnMi.png` | http(s) URL | Icon used in embed footers |
| `OFFLINE_SERVER_IMAGE` | No | `https://i.imgur.com/WnS0Biz.png` | http(s) URL | Image used for an offline server |
| `MAP_IMAGE_BASE_URL` | No | `https://bans.snksrv.com/images/maps/` | http(s) URL ending in `/`, or empty | Map thumbnails are requested as `<base><mapname>.jpg`. A map the host has no image for simply renders without one. Empty disables map images |
| `RATE_LIMIT_FOLLOW_PER_MINUTE` | No | `5` | 1 to 1000 | Max follow commands per minute per user |
| `RATE_LIMIT_UNFOLLOW_PER_MINUTE` | No | `5` | 1 to 1000 | Max unfollow commands per minute per user |
| `RATE_LIMIT_NOTIFICATION_PER_MINUTE` | No | `10` | 1 to 1000 | Max map-change DMs per minute per user. Repeats of the same map (for example one map live on two servers) are always collapsed to one DM and do not count against this |
| `MAX_FOLLOWS_PER_USER` | No | `50` | 1 to 10000 | Maximum maps a single user may follow at once |
| `MAX_NOTIFICATION_RECIPIENTS` | No | `200` | 1 to 10000 | Maximum users DMed for a single map change; a truncated fanout is logged |
| `HEALTH_PORT` | No | `3000` | 0 to 65535 | Port for the `GET /health` liveness endpoint, which reports 503 once no update tick has started in three intervals. This is the port the image's `HEALTHCHECK` probes, so leave it alone under Docker; `0` opens no socket and makes that healthcheck fail |
| `HEALTH_HOST` | No | `127.0.0.1` | non-empty | Address the health endpoint binds to. Loopback keeps it reachable from inside the container only; set `0.0.0.0` and publish the port for an external monitor |

Rate limits, the user cache and the per-map notification history are all held in memory, so a
restart clears every rate limit currently in effect.

## Server Configuration

Add your servers to `servers.json`:

```json
{
  "ServerName": {
    "ip": "IP_ADDRESS:PORT",
    "nick": "Display Name",
    "protocol": "csgo",
    "keywords": ["keyword1", "keyword2"]
  }
}
```

**Maximum of 25 servers**, because the embed adds one field per server and Discord caps an
embed at 25 fields.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ip` | string | Yes | Server IP/FQDN, optionally with a port (e.g., `127.0.0.1:27015`). The port defaults to `27015` when omitted. IPv6 is not supported |
| `nick` | string | Yes | Display name shown in embeds (max 100 characters) |
| `protocol` | string | No | Game protocol (default: `csgo`), from the [supported games list](https://github.com/gamedig/node-gamedig/blob/master/GAMES_LIST.md) |
| `keywords` | array | Yes | Search keywords, at least one. Each must be lowercase, free of leading and trailing whitespace, at most 32 characters, and unique across all servers, since a lookup returns the first match |

## Development

```bash
npm run lint      # eslint
npm test          # node --test, everything under test/
```

The tests use Node's built-in runner, so there is nothing extra to install. They cover the pure
helpers (output limits, pagination, map names, escaping) and the two inputs that decide whether the
bot starts at all (the environment and `servers.json`), plus the follow operations against a real
SQLite file in a temporary directory. `servers.json` must exist before running them, exactly as it
must before running the bot.
