# GrabInsta — verification report

Date: 2026-11-10. Machine: Node v24.22.1, npm 10.9.4, cloud VM (not Hostinger).

## 1. What the extraction library is

**Package:** `instagram-url-direct` by victorsouzaleal — npm `instagram-url-direct@2.0.7` (latest), MIT licence.
**Repo:** https://github.com/victorsouzaleal/instagram-direct-url — 88 stars, 21 forks, 111 commits, last commit `3cf6d79` on **2025-06-02**. Not archived.
**Source inspected:** single file `src/instagram.ts` (plus `package.json`, `tsconfig.json`). Runtime dependencies: `axios ^1.7.7`, `qs ^6.13.0`. No cheerio in 2.x, no browser/FFmpeg/yt-dlp.
**How it works:** `GET https://www.instagram.com/` → take the `csrftoken` cookie → `POST https://www.instagram.com/graphql/query` with a hardcoded `doc_id` (`9510064595728286`) and `{ shortcode }` → parse `data.xdt_shortcode_media`. Carousel (`XDTGraphSidecar`) children are expanded. Retries 429/403 with `Retry-After`, exponential back-off.
**Known weaknesses (from reading the source):** no request timeout on its own calls; CSRF extraction assumes `set-cookie[0]` is the token; shortcode parsing is a naive `split('/')`; the `/share/` redirect path does `axios.get(url)` with no SSRF guard (GrabInsta rejects `/share/` links before the library is ever called, so that path is unreachable here); the GraphQL `doc_id` is a single hardcoded value that Instagram can invalidate at any time.
**Open issues (5, via GitHub API 2026-11-10):**
- #44 (2026-07-23) — "Error: Failed instagram request: Only posts/reels supported, check if your link is valid."
- #43 (2025-10-21) — "401 Request Error"
- #42 (2025-07-27) — "Must be reel error"
- #39 (2025-05-15) — "can't we use cookies here?"
- #35 (2025-05-03, PR) — "Added owner_profile_pic to response"

## 2. Automated fixture tests — PASSED

Run: `npm install && npm test` (Node `--test`, mock extractor, no Instagram network).

Result at build time: **17 tests passed, 0 failed** (see the test run in the delivery message; re-run `npm test` after any change). Coverage:
- `tests/validate.test.js` — Reel/post/TV/`/reels/`/username-prefixed acceptance, tracking-param stripping, rejection of Stories, `/share/`, profiles, Explore, shorteners, non-Instagram hosts, bad shortcodes and bad schemes.
- `tests/normalize.test.js` — single-video normalisation, carousel dedupe/order, non-CDN URL dropped, `http:`/credential URLs rejected, private → `unavailable_private`, empty → `extraction_failed`.
- `tests/api.test.js` — `/healthz`, `/api/resolve` success + cache (2nd identical call served from cache, extractor called once), 400 `invalid_link` with no stack trace, 401→502 `upstream_blocked`, private→404, timeout→504, rate-limit→429 with `Retry-After`, frontend served at `/`, JSON 404 for unknown API routes.

These tests prove the app's own logic. They do **not** prove Instagram extraction works.

## 2b. Server smoke test — PASSED (app behaviour, live extractor)

Started with `PORT=3123 node server.js` and curled the running app:
- `GET /healthz` → 200 `{"ok":true,"service":"grabinsta","extractor":"instagram-url-direct","cacheSize":0,"activeExtractions":0}`
- `GET /` → 200, frontend HTML served (4,392 bytes)
- `POST /api/resolve` with a profile URL → 400 `invalid_link`
- `POST /api/resolve` with `https://bit.ly/abc123` → 400 `invalid_link` (SSRF check: non-Instagram destination rejected before any fetch)
- `POST /api/resolve` with the real NASA Reel `DTQXTbvjp4y` → 502 `upstream_blocked`, with the honest message above. No fake media URL was returned.

## 3. Real Instagram tests — FAILED (extraction unverified)

Live test, `instagram-url-direct@2.0.7`, `instagramGetUrl(url, { retries: 1, delay: 1000 })`, 2026-11-10:

| URL (public, from web search) | Result | Time |
|---|---|---|
| https://www.instagram.com/reel/DTQXTbvjp4y/ (NASA, 2026-01-08) | FAILED — `Failed instagram request: socket hang up` | 7.1 s |
| https://www.instagram.com/tv/CdmYaq3LAYo/ (README example) | FAILED — `Failed instagram request: Request failed with status code 401` | 0.9 s |
| https://www.instagram.com/reel/DULh7HFEv54/ (Planetary Society) | FAILED — `… status code 401` | 0.9 s |
| https://www.instagram.com/reel/DR0XZpeDRSh/ (Scientific American) | FAILED — `… status code 401` | 0.5 s |

Cross-checks (same machine, browser User-Agent):
- `GET https://www.instagram.com/` → **200**, 516 KB. Instagram is reachable; this is not a network outage.
- Manual CSRF + GraphQL with the library's `doc_id`: **401** — `{"message":"Please wait a few minutes before you try again.","require_login":true,"status":"fail"}`.
- `GET /reel/DTQXTbvjp4y/embed/` → 200 but only the generic logged-out shell; no media CDN URLs in the body.
- `GET /reel/DTQXTbvjp4y/?__a=1` → 200 with `{"error":1357055,"errorSummary":"Your Request Couldn't be Processed","payload":null}`.

**Conclusion: extraction is UNVERIFIED and, on this evidence, NOT WORKING.**
No Reel, photo or carousel download was demonstrated end-to-end. No download
URL, preview or metadata in this report is from a live Instagram post — the
only real media URLs in the repo are fixtures in `tests/`. The app therefore
returns `upstream_blocked` (502) for these links today, with a plain-language
explanation, rather than a fabricated link.

## 4. What remains unverified / deployment requirements

1. **A successful live resolve on Hostinger has not been demonstrated.** After
   deploying, paste a public Reel link and check whether `/api/resolve`
   returns media or `upstream_blocked`. Hostinger's IP range may be treated
   differently from this cloud VM — it could work better or worse. Do not
   assume either outcome until you test it there.
2. **No carousel/photo live test passed**, for the same reason — the failure
   is at the GraphQL step, before any media type is reached.
3. **Node.js version on the account is not verified.** Public sources
   disagree (some list 18/20/22 only, others 18/20/22/24 for Business).
   In hPanel, pick **24 if listed, otherwise 22**. The app accepts 20–24.
   If hPanel shows no Node.js Web App option at all, managed Node.js is
   unavailable on that account — that is the blocker, and the app cannot
   run as a PHP/static upload.
4. **Instagram may change or block this endpoint at any time**, even if a
   live test later succeeds. The adapter boundary (`src/extractors/`) is
   the repair point; a future fix may need a different endpoint, a
   logged-in session (out of scope for v1), or a different library.
5. **Rate limits on Hostinger** (process count, 120 s request cap) were
   checked against documentation only, not by running on the account.
