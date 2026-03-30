# Transcript Viewer

A web app for viewing and annotating AI conversation transcripts.

![Demo](static/demo.gif)

## Quick Start

```bash
git clone git@github.com:aengusl/transcript-viewer.git
cd transcript-viewer
npm install
cp .env.example .env
# Set TRANSCRIPT_DIR in .env to point to your transcripts folder
npm run dev
```

Open http://localhost:5173

## Features

**Beautiful UI** — Dark mode, bold message tiles, full-width transcript view

**Keyboard shortcuts** — `Cmd+U` comment, `Cmd+I` highlight, `Cmd+J` sidebar, `Cmd+K` search

**Comments** — Sign in as guest or user, leave feedback on specific messages

**Slideshow view** — Highlight text, add descriptions, flick through key moments

**Summary regeneration** — Include comments, highlights, custom instructions. Summaries cite specific messages.

**Filtering** — Search transcripts, filter by system prompt, tool calls, or messages with comments

**Branches** — View different conversation branches the auditor took before rollbacks

**Tool call rendering** — Specialized views for terminal, file read/edit, diffs, send_message, subagents. Compact mode toggle. Inline paired results.

**Authentication** — Optional session-based login page. Set `AUTH_PASSWORD` to enable.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TRANSCRIPT_DIR` | Yes | Directory containing transcript JSON files |
| `AUTH_PASSWORD` | No | Shared password for login page. If unset, auth is disabled. |
| `ANTHROPIC_API_KEY` | No | Only needed for summary regeneration feature |

## Deployment (Docker)

### 1. Prepare the VPS

```bash
# Clone the repo on your VPS
git clone git@github.com:aengusl/transcript-viewer.git
cd transcript-viewer

# Create the transcripts directory (rsync target)
sudo mkdir -p /srv/transcripts

# Create production env file
cp .env.production.example .env.production
```

Edit `.env.production`:

```bash
AUTH_PASSWORD=your-strong-password-here
TRANSCRIPT_HOST_DIR=/srv/transcripts
LISTEN_PORT=8080
ORIGIN=https://yourdomain.com
```

### 2. Build and run

```bash
docker compose --env-file .env.production up -d --build
```

The app is now running on port 8080 (or whatever `LISTEN_PORT` you set), with nginx in front handling rate limiting and bot blocking.

### 3. Sync transcripts

From your local machine:

```bash
rsync -avz ./outputs/ youruser@vps:/srv/transcripts/
```

The app uses file watching (`chokidar`) — new transcripts appear automatically without restarting.

### 4. HTTPS

Put Cloudflare, Caddy, or certbot in front of the nginx container. Example with Caddy on the host:

```
yourdomain.com {
    reverse_proxy localhost:8080
}
```

### Architecture

```
Internet → HTTPS (Caddy/Cloudflare) → nginx (:8080)
                                         ├── rate limiting (5/min on /login, 30/s general)
                                         ├── bot user-agent blocking
                                         ├── robots.txt (disallow all)
                                         └── proxy → SvelteKit app (:3000)
                                                      ├── hooks.server.ts (session auth gate)
                                                      ├── /login (public)
                                                      └── everything else (requires session)

/srv/transcripts/ ← rsync ← local machine
       ↑ bind mount (read-only)
   docker container
```

### Sharing with collaborators

Send them the URL and password. Sessions last 7 days. No signup or per-user accounts needed — everyone uses the same shared password.

## License

MIT
