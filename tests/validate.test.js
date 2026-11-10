'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInstagramUrl } = require('../src/validate');

test('accepts a Reel and normalises it', () => {
  const r = parseInstagramUrl('https://www.instagram.com/reel/DTQXTbvjp4y/');
  assert.equal(r.canonicalUrl, 'https://www.instagram.com/reel/DTQXTbvjp4y/');
  assert.equal(r.shortcode, 'DTQXTbvjp4y');
  assert.equal(r.kind, 'reel');
});

test('strips tracking params and img_index', () => {
  const r = parseInstagramUrl('https://www.instagram.com/p/CxK9v2ABC12/?igsh=abc123&utm_source=ig&img_index=3');
  assert.equal(r.canonicalUrl, 'https://www.instagram.com/p/CxK9v2ABC12/');
  assert.equal(r.kind, 'post');
});

test('accepts desktop username-prefixed post, /reels/ and /tv/', () => {
  assert.equal(parseInstagramUrl('https://www.instagram.com/nasa/p/CxK9v2ABC12/').canonicalUrl, 'https://www.instagram.com/p/CxK9v2ABC12/');
  assert.equal(parseInstagramUrl('https://www.instagram.com/reels/DTQXTbvjp4y').kind, 'reel');
  assert.equal(parseInstagramUrl('https://www.instagram.com/tv/CdmYaq3LAYo/').kind, 'tv');
  assert.equal(parseInstagramUrl('instagram.com/reel/DTQXTbvjp4y/').canonicalUrl, 'https://www.instagram.com/reel/DTQXTbvjp4y/');
  assert.equal(parseInstagramUrl('https://m.instagram.com/reel/DTQXTbvjp4y/').host, 'm.instagram.com');
});

test('rejects stories, share links, profiles and explore pages', () => {
  for (const u of [
    'https://www.instagram.com/stories/nasa/123456789/',
    'https://www.instagram.com/share/p/CxK9v2ABC12',
    'https://www.instagram.com/share/reel/DTQXTbvjp4y',
    'https://www.instagram.com/nasa/',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/p/',
    'https://www.instagram.com/accounts/login/',
  ]) {
    assert.throws(() => parseInstagramUrl(u), (e) => e.code === 'invalid_link', u);
  }
});

test('rejects arbitrary destinations, shorteners and bad schemes', () => {
  for (const u of [
    'https://bit.ly/abc123',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.tiktok.com/@x/video/123',
    'javascript:alert(1)',
    'https://www.instagram.com.evil.com/p/CxK9v2ABC12/',
    'https://instagram.com@pwned.com/p/CxK9v2ABC12/',
    '',
    'not a url at all!!!',
  ]) {
    assert.throws(() => parseInstagramUrl(u), (e) => e.code === 'invalid_link', u);
  }
});

test('rejects bad shortcodes', () => {
  assert.throws(() => parseInstagramUrl('https://www.instagram.com/p/ab/'), (e) => e.code === 'invalid_link');
  assert.throws(() => parseInstagramUrl('https://www.instagram.com/p/abc$def123/'), (e) => e.code === 'invalid_link');
});
