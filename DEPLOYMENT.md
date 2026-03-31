# Deployment Guide

Deploy the transcript viewer as a Docker container on a VPS with password-protected access, anti-scraping protections, and hot-reloading transcripts via rsync.

## Prerequisites

- A VPS with Docker and Docker Compose installed
- A domain name (for HTTPS)
- SSH access to the VPS

## 1. Clone and configure

```bash
ssh youruser@vps

git clone git@github.com:aengusl/transcript-viewer.git
cd transcript-viewer

# Create the transcript directory
sudo mkdir -p /srv/transcripts
sudo chown $USER:$USER /srv/transcripts

# Create production config
cp .env.production.example .env.production
```

Edit `.env.production`:

```bash
# Required: shared password for the login page
AUTH_PASSWORD=your-strong-password-here

# Required: host directory where you'll rsync transcripts into
TRANSCRIPT_HOST_DIR=/srv/transcripts

# Required: the public URL users visit (needed for CSRF protection)
ORIGIN=https://yourdomain.com

# Port the nginx container listens on (your reverse proxy forwards to this)
LISTEN_PORT=8080
```

## 2. Build and start

```bash
docker compose --env-file .env.production up -d --build
```

This starts two containers:
- **app**: SvelteKit server (port 3000, internal only)
- **nginx**: Reverse proxy (port 8080, exposed) with rate limiting and bot blocking

Verify it's running:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
# Should return 303 (redirect to /login)
```

## 3. Set up HTTPS

The nginx container listens on HTTP. Put an HTTPS reverse proxy in front of it.

**Option A: Caddy (simplest)**

```bash
sudo apt install caddy
```

Add to `/etc/caddy/Caddyfile`:

```
yourdomain.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy handles TLS certificates automatically via Let's Encrypt.

**Option B: Cloudflare**

Point your domain's DNS to the VPS IP through Cloudflare. Set SSL mode to "Full (strict)" and use Cloudflare's origin certificates.

## 4. Sync transcripts

From your local machine:

```bash
rsync -avz ./outputs/ youruser@vps:/srv/transcripts/
```

The app watches the transcript directory with `chokidar` — new files appear automatically without restarting. You can set up a cron job or run this after each eval batch.

**Tip**: To sync only new files efficiently:

```bash
rsync -avz --ignore-existing ./outputs/ youruser@vps:/srv/transcripts/
```

## 5. Share with collaborators

Send them:
1. The URL: `https://yourdomain.com`
2. The password you set in `AUTH_PASSWORD`

Sessions last 7 days. No signup or per-user accounts — everyone uses the same shared password.

## Security model

### What's protected

- **Session-based auth**: `hooks.server.ts` gates every request. No page data, API response, or transcript content is served without a valid session cookie.
- **Login page**: The only public route. SvelteKit form actions with built-in CSRF protection.
- **Cookies**: `httpOnly`, `secure` (in production), `sameSite=lax`. Not accessible to JavaScript.

### Anti-scraping

- `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on all authenticated responses
- `robots.txt` returns `Disallow: /`
- Bot user-agents blocked at nginx level (returns 403)
- No sitemap, no public links

### Rate limiting (nginx)

- `/login`: 5 requests/minute per IP (burst 3) — prevents brute-force
- All other routes: 30 requests/second per IP (burst 50)
- Connection limit: 20 concurrent per IP (5 for login)

### Network architecture

```
Internet
  │
  ▼
HTTPS termination (Caddy / Cloudflare)
  │
  ▼
nginx container (:8080)
  ├── robots.txt → Disallow all
  ├── bot user-agent → 403
  ├── rate limiting
  └── proxy → SvelteKit app (:3000)
                ├── hooks.server.ts → session check
                ├── /login → public
                └── everything else → requires valid session
```

## Operations

### View logs

```bash
docker compose --env-file .env.production logs -f app
docker compose --env-file .env.production logs -f nginx
```

### Rebuild after code changes

```bash
git pull
docker compose --env-file .env.production up -d --build
```

### Change the password

Edit `.env.production`, then restart:

```bash
docker compose --env-file .env.production up -d
```

Existing sessions remain valid until they expire (7 days). To force everyone to re-login, restart the app container (sessions are in-memory):

```bash
docker compose --env-file .env.production restart app
```

### Check disk usage

```bash
du -sh /srv/transcripts/
docker system df
```
