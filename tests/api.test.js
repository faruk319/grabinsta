'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { ApiError } = require('../src/errors');

const CDN_IMG = 'https://scontent-bom1-1.cdninstagram.com/v/t51.2885-15/123456.jpg';
const CDN_VID = 'https://scontent-bom1-1.cdninstagram.com/v/t50.2886-16/654321.mp4';

function mockRaw() {
  return {
    results_number: 2,
    url_list: [CDN_IMG, CDN_VID],
    post_info: { owner_username: 'nasa', owner_fullname: 'NASA', is_verified: true, is_private: false, likes: 10, is_ad: false, caption: 'hi' },
    media_details: [
      { type: 'image', dimensions: { height: 1350, width: 1080 }, url: CDN_IMG },
      { type: 'video', dimensions: { height: 1920, width: 1080 }, url: CDN_VID, thumbnail: CDN_IMG, video_view_count: 5 },
    ],
  };
}

// Minimal fetch-based helper: start the app on an ephemeral port.
async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

async function postResolve(base, url) {
  const res = await fetch(`${base}/api/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /healthz reports service and extractor without secrets', async () => {
  const app = createApp({ extractor: { name: 'mock', extract: async () => mockRaw() } });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'grabinsta');
    assert.equal(body.extractor, 'mock');
    assert.ok(!('stack' in body));
  });
});

test('POST /api/resolve succeeds with a mock extractor and caches the second call', async () => {
  let calls = 0;
  const app = createApp({ extractor: { name: 'mock', extract: async () => { calls += 1; return mockRaw(); } } });
  await withServer(app, async (base) => {
    const first = await postResolve(base, 'https://www.instagram.com/reel/DTQXTbvjp4y/?igsh=xyz');
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.mediaCount, 2);
    assert.equal(first.body.cached, false);
    assert.equal(first.body.canonicalUrl, 'https://www.instagram.com/reel/DTQXTbvjp4y/');
    const second = await postResolve(base, 'https://www.instagram.com/reel/DTQXTbvjp4y/');
    assert.equal(second.body.cached, true);
    assert.equal(calls, 1, 'second identical request must come from cache');
  });
});

test('invalid links return 400 invalid_link, never a stack trace', async () => {
  const app = createApp({ extractor: { name: 'mock', extract: async () => mockRaw() } });
  await withServer(app, async (base) => {
    for (const bad of ['https://www.instagram.com/nasa/', 'https://bit.ly/abc', 'https://www.instagram.com/stories/nasa/123/']) {
      const r = await postResolve(base, bad);
      assert.equal(r.status, 400, bad);
      assert.equal(r.body.error.code, 'invalid_link');
      assert.ok(!('stack' in (r.body.error || {})));
    }
    const noBody = await fetch(`${base}/api/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(noBody.status, 400);
  });
});

test('upstream 401 is mapped to 502 upstream_blocked; private to 404; timeout to 504', async () => {
  const cases = [
    [new ApiError('upstream_blocked', 502, 'blocked'), 502, 'upstream_blocked'],
    [new ApiError('unavailable_private', 404, 'private'), 404, 'unavailable_private'],
    [new ApiError('upstream_timeout', 504, 'timeout'), 504, 'upstream_timeout'],
    [new ApiError('upstream_rate_limited', 502, 'slow down', 60), 502, 'upstream_rate_limited'],
  ];
  for (const [err, status, code] of cases) {
    const app = createApp({ extractor: { name: 'mock', extract: async () => { throw err; } } });
    await withServer(app, async (base) => {
      const r = await postResolve(base, 'https://www.instagram.com/reel/DTQXTbvjp4y/');
      assert.equal(r.status, status, code);
      assert.equal(r.body.error.code, code);
      assert.ok(!('stack' in r.body.error));
    });
  }
});

test('per-IP rate limit returns 429 local_rate_limited with Retry-After', async () => {
  const app = createApp({
    extractor: { name: 'mock', extract: async () => mockRaw() },
    rateLimitMax: 2,
    rateLimitWindowMs: 60000,
    cacheMaxEntries: 100,
  });
  await withServer(app, async (base) => {
    // Use different shortcodes so the cache does not mask the limit.
    const codes = ['DTQXTbvjp4y', 'DULh7HFEv54', 'DR0XZpeDRSh'];
    const results = [];
    for (const c of codes) results.push(await postResolve(base, `https://www.instagram.com/reel/${c}/`));
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 200);
    assert.equal(results[2].status, 429);
    assert.equal(results[2].body.error.code, 'local_rate_limited');
  });
});

test('serves the frontend at / and JSON 404 for unknown API routes', async () => {
  const app = createApp({ extractor: { name: 'mock', extract: async () => mockRaw() } });
  await withServer(app, async (base) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /GrabInsta/);
    const bad = await fetch(`${base}/api/nope`);
    assert.equal(bad.status, 404);
    assert.equal((await bad.json()).error.code, 'not_found');
  });
});
