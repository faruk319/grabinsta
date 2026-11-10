'use strict';

/**
 * Adapter for instagram-url-direct (victorsouzaleal/instagram-direct-url).
 *
 * EVALUATION — read 2026-11-10, see VERIFICATION.md for the full report:
 *  - Version pinned by package.json: ^2.0.7 (latest). License: MIT.
 *  - Single-file source (src/instagram.ts): GET https://www.instagram.com/
 *    for a csrftoken cookie, then POST https://www.instagram.com/graphql/query
 *    with a hardcoded doc_id (9510064595728286), parsing
 *    data.xdt_shortcode_media. Sidecar (carousel) support is in the parser.
 *  - Runtime deps: axios ^1.7.7, qs ^6.13.0. No browser, no FFmpeg, no yt-dlp.
 *  - Last commit 2025-06-02; 88 stars; 5 open issues, including a July 2026
 *    "Only posts/reels supported" failure and an Oct 2025 401 report.
 *  - LIVE TEST 2026-11-10 (this machine): 4 real public URLs all failed —
 *    3× HTTP 401, 1× socket hang-up. A manual GraphQL call with a browser
 *    User-Agent and a fresh CSRF token also returned 401
 *    {"require_login":true}. Instagram is currently login-gating this
 *    endpoint for anonymous server requests. Extraction is therefore
 *    UNVERIFIED / NOT WORKING at the time of writing — the app reports
 *    that honestly as `upstream_blocked` instead of fabricating links.
 *
 * SAFETY: this adapter is only ever called with a canonical URL that
 * src/validate.js has already accepted (instagram.com /p|reel|reels|tv).
 * It never fetches an arbitrary user-supplied URL: the library itself
 * only contacts instagram.com (homepage for CSRF + graphql/query).
 * /share/ links are rejected by validation, so the library's unguarded
 * redirect-follow path is never reached. A per-call timeout bounds it.
 */

const { ApiError, upstreamBlocked, upstreamRateLimited, upstreamTimeout, extractionFailed } = require('../errors');

function parseRetryAfter(err) {
  const raw = err && err.response && err.response.headers && err.response.headers['retry-after'];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 3600 ? n : undefined;
}

function classifyError(err, timedOut) {
  if (timedOut) return upstreamTimeout();
  if (err instanceof ApiError) return err;
  const status = err && err.response && err.response.status;
  const msg = String((err && err.message) || '');
  if (status === 429) return upstreamRateLimited(parseRetryAfter(err));
  if (status === 401 || status === 403) return upstreamBlocked();
  if (/401|403|require_login|login required/i.test(msg)) return upstreamBlocked();
  if (/429|too many requests|rate limit/i.test(msg)) return upstreamRateLimited(parseRetryAfter(err));
  if (/timeout|timed out|socket hang up|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(msg)) return upstreamTimeout();
  if (/only posts\/reels supported|not found|404/i.test(msg)) {
    return new ApiError('unavailable_private', 404, 'This post could not be found, or it is private / needs login.');
  }
  return extractionFailed();
}

async function extract(canonicalUrl, { timeoutMs = 12000 } = {}) {
  let instagramGetUrl;
  try {
    // The package ships both ESM and CJS; require() resolves dist/instagram.cjs.
    ({ instagramGetUrl } = require('instagram-url-direct'));
  } catch (e) {
    throw extractionFailed();
  }
  if (typeof instagramGetUrl !== 'function') throw extractionFailed();

  let timer;
  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('extraction timed out'));
    }, timeoutMs);
    timer.unref && timer.unref();
  });

  try {
    // The library retries 429/403 internally (default 5 retries); we pass
    // a smaller budget so one request cannot hang the server for minutes.
    const raw = await Promise.race([
      instagramGetUrl(canonicalUrl, { retries: 2, delay: 1000 }),
      timeoutPromise,
    ]);
    return raw;
  } catch (err) {
    throw classifyError(err, timedOut);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { name: 'instagram-url-direct', extract };
