'use strict';

const path = require('path');
const express = require('express');
const { parseInstagramUrl } = require('./validate');
const { normalizeResult } = require('./normalize');
const { ApiError, extractionFailed } = require('./errors');
const { BoundedCache } = require('./cache');
const { createRateLimiter, createSemaphore } = require('./rate-limit');
const { getExtractor } = require('./extractors');

function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build the Express app. `overrides.extractor` lets tests inject a mock
 * extractor without touching the network; production always uses the
 * registered adapter from src/extractors.
 */
function createApp(overrides = {}) {
  const app = express();

  // Reverse-proxy trust: Hostinger terminates TLS at exactly one proxy hop
  // (Passenger / LiteSpeed in front of the Node process). Trust that one
  // hop so req.ip is the visitor, and no further X-Forwarded-For chain.
  // Never read X-Forwarded-For directly, and never set trust proxy to true.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const extractor = overrides.extractor || getExtractor();
  const upstreamTimeoutMs = overrides.upstreamTimeoutMs || envInt('UPSTREAM_TIMEOUT_MS', 12000);
  const cache = new BoundedCache(
    overrides.cacheMaxEntries || envInt('CACHE_MAX_ENTRIES', 100),
    overrides.cacheTtlMs || envInt('CACHE_TTL_MS', 5 * 60 * 1000),
  );
  const semaphore = createSemaphore(
    overrides.maxConcurrentExtractions || envInt('MAX_CONCURRENT_EXTRACTIONS', 2),
    5,
  );
  const rateLimit = createRateLimiter({
    max: overrides.rateLimitMax || envInt('RATE_LIMIT_MAX', 10),
    windowMs: overrides.rateLimitWindowMs || envInt('RATE_LIMIT_WINDOW_MS', 60 * 1000),
  });

  // Security headers (no extra dependency). CSP allows media previews
  // only from Instagram's CDN; scripts/styles are same-origin only.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; " +
      "img-src 'self' https://*.cdninstagram.com https://*.fbcdn.net https://static.cdninstagram.com data:; " +
      "media-src 'self' https://*.cdninstagram.com https://*.fbcdn.net; " +
      "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
    return next();
  });

  app.use(express.json({ limit: '10kb' }));

  // Health check for Hostinger / uptime monitors. No secrets, no stack traces.
  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      service: 'grabinsta',
      version: '1.0.0',
      extractor: extractor.name || 'unknown',
      uptimeSeconds: Math.floor(process.uptime()),
      cacheSize: cache.size,
      activeExtractions: semaphore.active,
    });
  });

  // Resolve one Instagram link into validated CDN download links.
  // Media files are NOT relayed through Hostinger: the response only
  // contains direct CDN URLs, so large files never touch this server.
  app.post('/api/resolve', rateLimit, async (req, res, next) => {
    let parsed;
    try {
      const rawUrl = req.body && req.body.url;
      if (typeof rawUrl !== 'string') {
        return res.status(400).json({ ok: false, error: { code: 'invalid_link', message: 'Send a JSON body like {"url": "https://www.instagram.com/reel/…/"}' } });
      }
      parsed = parseInstagramUrl(rawUrl);
    } catch (err) {
      return next(err);
    }

    const cached = cache.get(parsed.canonicalUrl);
    if (cached) return res.json({ ...cached, cached: true });

    try {
      await semaphore.acquire();
    } catch (err) {
      return next(err);
    }
    try {
      let raw;
      try {
        raw = await extractor.extract(parsed.canonicalUrl, { timeoutMs: upstreamTimeoutMs });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw extractionFailed();
      }
      const result = normalizeResult(raw, parsed);
      cache.set(parsed.canonicalUrl, result);
      return res.json({ ...result, cached: false });
    } catch (err) {
      return next(err);
    } finally {
      semaphore.release();
    }
  });

  // Static frontend — same app, same origin.
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

  // Unknown API routes: JSON, not the frontend HTML.
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Unknown API route.' } });
  });

  // Central error handler. Logs server-side only; visitors get a code
  // and a plain message, never a stack trace or an upstream body.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) } });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: { code: 'invalid_link', message: 'Request body must be valid JSON.' } });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: { code: 'invalid_link', message: 'Request body is too large.' } });
    }
    console.error('Unhandled error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { code: 'extraction_failed', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}

module.exports = { createApp };
