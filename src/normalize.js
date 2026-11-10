'use strict';

const { ApiError, unavailablePrivate, extractionFailed } = require('./errors');

// Hosts Instagram actually serves media from. A media URL from anywhere
// else is dropped, never returned to the browser (SSRF / open-redirect
// defence, layer 2). Covers scontent-*.cdninstagram.com, fbcdn.net
// subdomains and static.cdninstagram.com.
function isAllowedMediaHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h.includes('..')) return false;
  return (
    h === 'cdninstagram.com' ||
    h.endsWith('.cdninstagram.com') ||
    h === 'fbcdn.net' ||
    h.endsWith('.fbcdn.net') ||
    h === 'static.cdninstagram.com'
  );
}

function validateMediaUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!isAllowedMediaHost(u.hostname)) return null;
  // Strip any query/fragment the CDN URL may carry; the path is the file.
  return `https://${u.hostname}${u.pathname}`;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function cleanCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Normalise one raw extractor result into the public API shape.
 * The raw result is trusted for nothing: every media URL is re-validated,
 * counts are coerced, and text is length-capped. The frontend renders all
 * text with textContent, so a caption can never become HTML (XSS defence).
 *
 * Raw shape (instagram-url-direct 2.0.7):
 *   { results_number, url_list, post_info: {owner_username, owner_fullname,
 *     is_verified, is_private, likes, is_ad, caption},
 *     media_details: [{type, dimensions:{width,height}, url, thumbnail,
 *     video_view_count}] }
 */
function normalizeResult(raw, { canonicalUrl, shortcode, kind }) {
  if (!raw || typeof raw !== 'object') throw extractionFailed();

  const info = raw.post_info || {};
  if (info.is_private === true) throw unavailablePrivate();

  const details = Array.isArray(raw.media_details) ? raw.media_details : [];
  const urlList = Array.isArray(raw.url_list) ? raw.url_list : [];
  const seen = new Set();
  const media = [];

  // Prefer media_details (it carries type/dimensions/thumbnail); fall back
  // to url_list only if media_details is empty.
  const items = details.length > 0
    ? details.map((d) => ({ type: d && d.type, url: d && d.url, thumbnail: d && d.thumbnail, width: d && d.dimensions && d.dimensions.width, height: d && d.dimensions && d.dimensions.height, views: d && d.video_view_count }))
    : urlList.map((u) => ({ type: null, url: u, thumbnail: null }));

  for (const item of items) {
    const url = validateMediaUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const type = item.type === 'video' ? 'video' : 'image';
    // A video item whose URL ends in an image extension (or vice versa)
    // is still served as its declared type; the browser decides by content.
    media.push({
      index: media.length,
      type,
      url,
      downloadUrl: url,
      thumbnail: validateMediaUrl(item.thumbnail),
      width: cleanCount(item.width) || null,
      height: cleanCount(item.height) || null,
      videoViewCount: type === 'video' ? cleanCount(item.views) || null : null,
    });
  }

  if (media.length === 0) throw extractionFailed();

  return {
    ok: true,
    kind,
    shortcode,
    canonicalUrl,
    owner: {
      username: cleanText(info.owner_username, 30),
      fullName: cleanText(info.owner_fullname, 100),
      isVerified: info.is_verified === true,
      isPrivate: info.is_private === true,
    },
    likes: cleanCount(info.likes),
    caption: cleanText(info.caption, 500),
    media,
    mediaCount: media.length,
  };
}

module.exports = { normalizeResult, validateMediaUrl, isAllowedMediaHost };
