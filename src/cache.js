'use strict';

// Small, bounded, short-lived in-memory cache. No database in v1.
// Evicts the oldest entry when full; entries expire after TTL.
class BoundedCache {
  constructor(maxEntries = 100, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.map = new Map(); // key -> { value, expiresAt }
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this.map.delete(key); return undefined; }
    // Refresh recency without extending TTL.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  get size() { return this.map.size; }
}

module.exports = { BoundedCache };
