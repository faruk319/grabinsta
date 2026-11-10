# GrabInsta

Download public Instagram Reels, single photos/videos, and carousels — one
download link per slide. Same-origin Node.js + Express app for Hostinger
Business managed Node.js hosting. No database, no FFmpeg, no yt-dlp, no
browser automation, no paid downloader API, no VPS/Docker.

> **Read this first — extraction feasibility (honest, tested 2026-11-10).**
> The extraction adapter is `instagram-url-direct` v2.0.7 (MIT, deps
> `axios` + `qs`). It fetches a CSRF token from instagram.com, then POSTs
> Instagram's GraphQL endpoint (`doc_id 9510064595728286`) and parses
> `xdt_shortcode_media`, including carousels. Live-tested against 4 real
> public Reels on 2026-11-10, it **failed every time**: 3× HTTP 401 and
> 1× socket hang-up. A manual GraphQL call with a browser User-Agent and a
> fresh CSRF token also returned 401 `{"require_login":true}`. Instagram
> is currently login-gating that endpoint for anonymous server requests.
> **Extraction is therefore UNVERIFIED / NOT WORKING right now.** GrabInsta
> is built so this can be repaired by swapping one adapter file
> (`src/extractors/`), and until then it reports `upstream_blocked`
> honestly instead of inventing links. Full evidence: `VERIFICATION.md`.

## Architecture

```
Browser ── same origin ──► Express (server.js / src/app.js)
                              ├─ GET  /            → public/index.html (custom UI)
                              ├─ GET  /healthz    → { ok, service, extractor, uptime }
                              └─ POST /api/resolve → validate → cache → semaphore
                                                              → extractor → normalise
                                                              → validated CDN links
Instagram ── GraphQL ──► instagram-url-direct adapter (src/extractors/)
Media CDN   ── direct ──► browser (video/photo opens from *.cdninstagram.com)
```

- **Frontend and API, one app, one origin.** `public/` is served by the
  same Express process. No Muse-hosted backend, no serverless functions.
- **No media relay.** The API returns validated Instagram CDN URLs only.
  Large files never pass through Hostinger, so shared-hosting memory and
  the 120-second request limit are not a problem for downloads.
- **Separated extraction.** `src/extractors/index.js` is the only place
  that knows which library talks to Instagram. Routes, validation,
  normalisation and the frontend never import the library directly.
- **Validation & SSRF defence.** Only `instagram.com` / `www` / `m` /
  `instagr.am` hosts and `/p|reel|reels|tv/<shortcode>` paths are accepted.
  Tracking parameters are stripped. `/share/`, Stories, profiles, shorteners
  and any non-Instagram destination are rejected *before* any network call,
  so a pasted link can never make the server fetch an arbitrary URL. The
  adapter itself only contacts `instagram.com`. Returned media URLs must be
  `https://*.cdninstagram.com` or `https://*.fbcdn.net`.
- **Limits.** Per-IP rate limit (default 10/min), max 2 concurrent upstream
  extractions, 12 s upstream timeout, bounded in-memory cache (100 entries,
  5 min TTL), `Retry-After` respected and surfaced. `trust proxy` is set to
  `1` (Hostinger terminates TLS at one proxy hop) — `X-Forwarded-For` is
  never read directly.
- **Errors are typed.** `invalid_link` (400), `unavailable_private` (404),
  `local_rate_limited` (429), `upstream_rate_limited` / `upstream_blocked` /
  `extraction_failed` (502), `upstream_timeout` (504). No stack traces or
  upstream bodies ever reach visitors; captions are rendered with
  `textContent` only.

## What it supports (v1)

- Public Reels (`/reel/…`, `/reels/…`)
- Single-photo and single-video feed posts (`/p/…`)
- Carousels (`/p/…` with several slides — one card + download link each)
- Excluded: Stories, private accounts, login-required content, audio
  conversion, video transcoding.

## Local setup

Requires Node.js 20+ (developed and tested on Node 24.22.1; Hostinger
target is 22 or 24 — see below).

```bash
cd grabinsta
cp .env.example .env   # optional; defaults work locally
npm install
npm test               # fixture tests (no Instagram network calls)
npm start              # listens on http://0.0.0.0:3000 by default
# open http://localhost:3000 — try a public Reel link
# health check: curl http://localhost:3000/healthz
```

Environment variables (all optional, see `.env.example`):
`PORT` (assigned by Hostinger — do not set it there), `NODE_ENV`,
`EXTRACTOR`, `UPSTREAM_TIMEOUT_MS` (default 12000), `RATE_LIMIT_MAX`
(default 10), `RATE_LIMIT_WINDOW_MS` (default 60000),
`MAX_CONCURRENT_EXTRACTIONS` (default 2), `CACHE_MAX_ENTRIES` (100),
`CACHE_TTL_MS` (300000).

## Deploy on Hostinger Business shared hosting (hPanel Node.js Web App)

Do **not** upload this into `public_html` as if it were a static site.
That will not run a Node.js server. Use the managed Node.js Web App flow:

**0. Check the plan first.** In hPanel, go to **Websites**. You must see a
Node.js / **Web App** option (Business plan: up to 5 Node.js websites).
If there is no Node.js Web App option on your account, stop here — managed
Node.js is unavailable on that account/plan, and this app cannot run on
shared PHP/static hosting. Contact Hostinger support or upgrade; do not
try the `public_html` workaround.

**1. Package the app.**
- Option A (recommended) — push this folder to a **GitHub** repository
  (private is fine). Do not commit `node_modules/` or `.env`.
- Option B — make a ZIP of this folder **excluding** `node_modules/`,
  `.env`, and any `grabinsta-*.zip`. On macOS/Linux:
  `zip -r grabinsta.zip . -x "node_modules/*" ".env" "*.zip"`

**2. Create the Web App.** hPanel → **Websites** → **Add Website** →
choose **Web App** (Node.js). Pick your domain or a subdomain
(e.g. `grab.example.com`). Select:
- **Node.js version:** **24** if it is listed; otherwise **22**.
  (The app runs on 20–24; `.nvmrc` ships as `22`. If you pick 24 in
  hPanel, you may update `.nvmrc` to `24` to match — it is not required.)
- **Source:** your GitHub repo (auto-deploy on push) **or** upload the ZIP.
- **Application root / startup file:** `server.js`
- **Install command:** `npm install`
- **Start command:** `npm start` (runs `node server.js`)

**3. Environment variables.** In the Web App's **Environment variables**
(or **Advanced settings**), set only:
- `NODE_ENV=production`
- Leave `PORT` **unset** — Hostinger assigns it and the app reads
  `process.env.PORT` and binds `0.0.0.0`.
- Nothing else is required. Do not paste any Instagram password or token
  — v1 has no login.

**4. Deploy and verify.**
- Press **Deploy** / **Create**, wait for the build, then open the **Logs**
  tab. You should see `GrabInsta listening on http://0.0.0.0:<PORT>`.
- Visit `https://<your-domain>/healthz` — expect
  `{"ok":true,"service":"grabinsta","extractor":"instagram-url-direct",…}`.
- Visit `https://<your-domain>/` and paste a public Reel link.
- If a resolve returns `upstream_blocked`, that is Instagram blocking the
  server (see the feasibility note at the top) — check `VERIFICATION.md`
  and the extractor before assuming a deploy error.

**Hostinger limits to know about:** Business shared hosting caps Node.js
processes (reported 120 NPROC per plan, shared across all sites), and
cuts off requests after ~120 seconds. This app stays inside those limits
by design (2 concurrent extractions, 12 s upstream timeout, no media
relay, no long-lived workers). No WebSocket, cron, or outbound proxy is
used. Free SSL is enabled in hPanel for the domain as usual.

## Tests

```bash
npm test
```

`node --test` (built-in, no test framework dependency):
- `tests/validate.test.js` — URL validation / normalisation / rejections
- `tests/normalize.test.js` — media-result normalisation, CDN allow-list,
  private/empty handling
- `tests/api.test.js` — `/healthz`, `/api/resolve` success + cache,
  failure mapping (400/404/429/502/504), rate limiting, static frontend

All tests use a mock extractor — they verify the app's own logic, not
Instagram. Real-Instagram results are reported separately in
`VERIFICATION.md` and are currently failing (see top of this README).

## Replacing the extractor

1. Add `src/extractors/<name>.js` exporting `{ name, extract }`, where
   `extract(canonicalUrl, { timeoutMs })` returns the raw result shape
   documented in `src/normalize.js`, or throws a typed `ApiError`.
2. Register it in `src/extractors/index.js` and set `EXTRACTOR=<name>`.
3. Only contact Instagram and its media CDN. Never route through an
   undisclosed third-party downloader service, and never return a URL you
   did not validate against the CDN allow-list.

## Legal note

Only download content you own or have permission to save, and respect the
creator's rights. Downloading does not transfer any rights. GrabInsta is
not affiliated with, endorsed by, or connected to Instagram or Meta.
