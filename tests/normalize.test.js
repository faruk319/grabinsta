'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResult, validateMediaUrl } = require('../src/normalize');

const CDN_IMG = 'https://scontent-bom1-1.cdninstagram.com/v/t51.2885-15/123456.jpg';
const CDN_VID = 'https://scontent-bom1-1.cdninstagram.com/v/t50.2886-16/654321.mp4';
const META = { canonicalUrl: 'https://www.instagram.com/reel/DTQXTbvjp4y/', shortcode: 'DTQXTbvjp4y', kind: 'reel' };

function rawSingle() {
  return {
    results_number: 1,
    url_list: [CDN_VID],
    post_info: { owner_username: 'nasa', owner_fullname: 'NASA', is_verified: true, is_private: false, likes: 230000, is_ad: false, caption: 'Hello <script>alert(1)</script> world' },
    media_details: [{ type: 'video', dimensions: { height: 1920, width: 1080 }, url: CDN_VID, thumbnail: CDN_IMG, video_view_count: 5000 }],
  };
}

test('normalises a single video reel', () => {
  const r = normalizeResult(rawSingle(), META);
  assert.equal(r.ok, true);
  assert.equal(r.mediaCount, 1);
  assert.equal(r.media[0].type, 'video');
  assert.equal(r.media[0].url, CDN_VID);
  assert.equal(r.media[0].downloadUrl, CDN_VID);
  assert.equal(r.owner.username, 'nasa');
  assert.equal(r.likes, 230000);
  // Caption is returned as plain text (frontend uses textContent); the
  // normaliser must not strip it into HTML, just cap its length.
  assert.ok(r.caption.includes('<script>'));
  assert.ok(r.caption.length <= 500);
});

test('normalises a carousel, dedupes, keeps order', () => {
  const raw = {
    results_number: 3,
    url_list: [CDN_IMG, CDN_VID, CDN_IMG],
    post_info: { owner_username: 'x', owner_fullname: '', is_verified: false, is_private: false, likes: 0, is_ad: false, caption: '' },
    media_details: [
      { type: 'image', dimensions: { height: 1350, width: 1080 }, url: CDN_IMG },
      { type: 'video', dimensions: { height: 1920, width: 1080 }, url: CDN_VID, thumbnail: CDN_IMG, video_view_count: 10 },
      { type: 'image', dimensions: { height: 1350, width: 1080 }, url: CDN_IMG },
    ],
  };
  const r = normalizeResult(raw, META);
  assert.equal(r.mediaCount, 2);
  assert.deepEqual(r.media.map((m) => m.type), ['image', 'video']);
  assert.deepEqual(r.media.map((m) => m.index), [0, 1]);
});

test('drops non-CDN media URLs instead of returning them', () => {
  const raw = rawSingle();
  raw.media_details[0].url = 'https://evil.example.com/video.mp4?x=1';
  raw.url_list = ['https://evil.example.com/video.mp4'];
  assert.throws(() => normalizeResult(raw, META), (e) => e.code === 'extraction_failed');
});

test('rejects http, credential and non-CDN URLs in validateMediaUrl', () => {
  assert.equal(validateMediaUrl('http://scontent.cdninstagram.com/a.jpg'), null);
  assert.equal(validateMediaUrl('https://user:pass@scontent.cdninstagram.com/a.jpg'), null);
  assert.equal(validateMediaUrl('https://example.com/a.jpg'), null);
  assert.equal(validateMediaUrl('https://scontent.cdninstagram.com/a.jpg?x=1#y'), 'https://scontent.cdninstagram.com/a.jpg');
  assert.equal(validateMediaUrl('https://video.fbcdn.net/v.mp4'), 'https://video.fbcdn.net/v.mp4');
});

test('private post becomes unavailable_private; empty media becomes extraction_failed', () => {
  const priv = rawSingle();
  priv.post_info.is_private = true;
  assert.throws(() => normalizeResult(priv, META), (e) => e.code === 'unavailable_private');
  assert.throws(() => normalizeResult({ post_info: { is_private: false }, media_details: [], url_list: [] }, META), (e) => e.code === 'extraction_failed');
  assert.throws(() => normalizeResult(null, META), (e) => e.code === 'extraction_failed');
});
