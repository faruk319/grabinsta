'use strict';

const { localRateLimited } = require('./errors');

// Fixed-window per-IP rate limit, in memory only. Shared hosting has one
// Node process, so one Map is enough for v1. Entries are pruned lazily.
function createRateLimiter({ max = 10, windowMs = 60 * 1000 } = {}) {
  const hits = new Map(); // ip -> { count, windowStart }
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let entry = hits.get(ip);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      hits.set(ip, entry);
    }
    // Prune stale entries occasionally so the map stays bounded.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.windowStart >= windowMs) hits.delete(k);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return next(localRateLimited(retryAfter));
    }
    return next();
  };
}

// Conservative upstream concurrency: at most `max` extractions run at
// once, so one burst cannot hammer Instagram or exhaust shared-hosting
// processes. Extra callers wait briefly; if the queue is full they get
// a local rate-limit instead of an unbounded wait.
function createSemaphore(max = 2, maxQueue = 5) {
  let active = 0;
  const queue = [];
  function pump() {
    while (active < max && queue.length > 0) {
      const { run } = queue.shift();
      active += 1;
      run();
    }
  }
  async function acquire() {
    if (active < max) { active += 1; return; }
    if (queue.length >= maxQueue) {
      throw localRateLimited(10);
    }
    await new Promise((resolve) => queue.push({ run: resolve }));
  }
  function release() {
    active = Math.max(0, active - 1);
    pump();
  }
  return {
    acquire, release,
    get active() { return active; },
    get queued() { return queue.length; },
  };
}

module.exports = { createRateLimiter, createSemaphore };
