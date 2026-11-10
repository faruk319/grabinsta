'use strict';

const { invalidLink } = require('./errors');

// Hosts we will ever accept. Everything else is rejected before any
// network call, so a pasted bit.ly / t.co / youtube.com link can never
// become a server-side fetch (SSRF defence, layer 1).
const ALLOWED_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
]);

// Shortcodes are Instagram's base64-ish post IDs. 5–30 chars, no slashes.
const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,30}$/;

// /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>
// and the desktop address-bar form /<username>/p/<code> etc.
const POST_PATH_RE = /^\/(?:([A-Za-z0-9._-]{1,30})\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,30})\/?$/;

// Paths that look like a post but are out of scope for v1.
const REJECTED_PREFIXES = ['stories', 'share', 'explore', 'accounts', 'direct', 'reels', 'p', 'tv'];

function parseInstagramUrl(rawInput) {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    throw invalidLink('Paste an Instagram link first.');
  }
  const input = rawInput.trim();
  if (input.length > 500) throw invalidLink('That link is too long to be an Instagram post link.');

  let url;
  try {
    // Accept links pasted without a scheme (instagram.com/p/...) by
    // adding https://, but never accept a non-http(s) scheme.
    url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`);
  } catch {
    throw invalidLink('That link could not be read as a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalidLink('Only https:// Instagram links are supported.');
  }
  if (url.username || url.password) {
    throw invalidLink('Links with embedded credentials are not supported.');
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw invalidLink('Only instagram.com (and instagr.am) links are supported.');
  }

  const path = url.pathname;
  const first = path.split('/').filter(Boolean)[0] || '';

  // Explicit, friendly rejections for the common near-misses.
  if (first === 'stories') throw invalidLink('Stories are not supported in this version — only Reels and feed posts.');
  if (first === 'share') throw invalidLink('Share links are not supported. Open the post and copy its normal link (instagram.com/reel/… or /p/…).');
  if (first === 'explore' || first === 'accounts' || first === 'direct') {
    throw invalidLink('That page is not a single post. Paste a link to one Reel or one feed post.');
  }
  if (REJECTED_PREFIXES.includes(first) && !POST_PATH_RE.test(path)) {
    throw invalidLink('That page is not a single post. Paste a link to one Reel or one feed post.');
  }

  const m = POST_PATH_RE.exec(path);
  if (!m) {
    // A bare profile (/username/) or any other Instagram page.
    throw invalidLink('That is not a single post link. Paste a Reel (/reel/…) or feed post (/p/…) link.');
  }
  const [, , kindRaw, shortcode] = m;
  if (!SHORTCODE_RE.test(shortcode)) throw invalidLink('The post ID in that link does not look valid.');

  const kind = kindRaw === 'p' ? 'post' : kindRaw === 'tv' ? 'tv' : 'reel';
  // Canonical form: always https://www.instagram.com/<kind>/<shortcode>/
  // Tracking parameters (?igsh=, ?utm_*, ?img_index=) are dropped entirely.
  const canonicalUrl = `https://www.instagram.com/${kindRaw === 'reels' ? 'reel' : kindRaw}/${shortcode}/`;
  return { canonicalUrl, shortcode, kind, host };
}

module.exports = { parseInstagramUrl, ALLOWED_HOSTS };
