'use strict';

/**
 * Typed API errors. `code` is the stable, user-visible code returned by
 * POST /api/resolve. `status` is the HTTP status. Never attach a stack
 * trace or an upstream body to an ApiError that reaches a visitor.
 *
 * Codes:
 *  invalid_link          — URL is not a supported public Instagram post link
 *  unavailable_private   — post is private, deleted, or needs login
 *  local_rate_limited    — this app's own per-IP limit was hit
 *  upstream_rate_limited — Instagram answered 429 / Retry-After
 *  upstream_blocked      — Instagram answered 401/403 or login-required
 *  upstream_timeout      — Instagram did not answer in time
 *  extraction_failed     — extractor ran but returned no usable media
 */
class ApiError extends Error {
  constructor(code, status, message, retryAfterSeconds) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

function invalidLink(detail) {
  return new ApiError('invalid_link', 400, detail || 'That does not look like a public Instagram post, Reel or TV link.');
}
function unavailablePrivate() {
  return new ApiError('unavailable_private', 404, 'This post is private, deleted, or needs an Instagram login. GrabInsta only works with public posts.');
}
function localRateLimited(retryAfterSeconds) {
  return new ApiError('local_rate_limited', 429, 'Too many requests from this address. Please wait a minute and try again.', retryAfterSeconds);
}
function upstreamRateLimited(retryAfterSeconds) {
  return new ApiError('upstream_rate_limited', 502, 'Instagram is rate-limiting requests right now. Please wait and try again later.', retryAfterSeconds);
}
function upstreamBlocked() {
  return new ApiError('upstream_blocked', 502, 'Instagram blocked this request (login required / access denied). The post may still be public in a browser, but Instagram is not serving it to this server right now.');
}
function upstreamTimeout() {
  return new ApiError('upstream_timeout', 504, 'Instagram took too long to answer. Please try again.');
}
function extractionFailed() {
  return new ApiError('extraction_failed', 502, 'Instagram answered, but no downloadable media could be found for this link.');
}

module.exports = {
  ApiError,
  invalidLink,
  unavailablePrivate,
  localRateLimited,
  upstreamRateLimited,
  upstreamBlocked,
  upstreamTimeout,
  extractionFailed,
};
