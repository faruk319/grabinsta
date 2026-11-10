'use strict';

/**
 * Extraction adapter registry.
 *
 * The rest of the app only knows this interface:
 *   extractor.extract(canonicalUrl, { timeoutMs }) -> raw result object
 *   (throws a typed ApiError on failure — see src/errors.js)
 *
 * To repair or replace Instagram extraction, add a file in this folder
 * exporting { name, extract }, register it below, and set EXTRACTOR=<name>.
 * No route, validation, normalisation or frontend code needs to change.
 * Do NOT point an adapter at an undisclosed third-party downloader
 * service: adapters may only contact Instagram and its media CDN.
 */
const instagramUrlDirect = require('./instagram-url-direct');

const ADAPTERS = {
  'instagram-url-direct': instagramUrlDirect,
};

function getExtractor(name) {
  const key = name || process.env.EXTRACTOR || 'instagram-url-direct';
  const adapter = ADAPTERS[key];
  if (!adapter) throw new Error(`Unknown extractor: ${key}`);
  return adapter;
}

module.exports = { getExtractor, ADAPTERS };
