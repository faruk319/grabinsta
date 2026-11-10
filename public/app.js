'use strict';

/* GrabInsta frontend — vanilla JS, no framework.
 * All server text (usernames, captions) is rendered with textContent /
 * createElement only — never innerHTML — so a caption cannot inject HTML.
 * Download links are direct Instagram CDN URLs: cross-origin, so the
 * browser opens the file in a new tab instead of forcing a save. The UI
 * says so plainly next to the results. */
(function () {
  var form = document.getElementById('resolve-form');
  var input = document.getElementById('url-input');
  var pasteBtn = document.getElementById('paste-btn');
  var clearBtn = document.getElementById('clear-btn');
  var submitBtn = document.getElementById('submit-btn');
  var submitLabel = submitBtn.querySelector('.btn-label');
  var spinner = submitBtn.querySelector('.spinner');
  var statusEl = document.getElementById('status');
  var pasteHint = document.getElementById('paste-hint');
  var resultsEl = document.getElementById('results');
  var ownerCard = document.getElementById('owner-card');
  var captionEl = document.getElementById('caption');
  var mediaGrid = document.getElementById('media-grid');

  var FRIENDLY = {
    invalid_link: ['That link does not work here', 'Paste a link to one public Reel or feed post — instagram.com/reel/… or instagram.com/p/…. Profiles, Stories, Explore pages and share links are not supported.'],
    unavailable_private: ['This post is not available', 'It may be private, deleted, or need a login. GrabInsta only works with public posts.'],
    local_rate_limited: ['Too many requests', 'Please wait a minute before trying again.'],
    upstream_rate_limited: ['Instagram is rate-limiting requests', 'Instagram asked us to slow down. Please wait a few minutes and try again.'],
    upstream_blocked: ['Instagram blocked this request', 'Instagram is currently asking for a login, or blocking server requests, for this post — even though it may open fine in your browser. Try again later, or try the link from a browser. No fake link has been created.'],
    upstream_timeout: ['Instagram took too long', 'The request timed out. Please try again.'],
    extraction_failed: ['No media was found', 'Instagram answered, but no downloadable photo or video came back for this link. Check the link is a public post or Reel.'],
    not_found: ['Not found', 'That address does not exist here.'],
  };

  function showStatus(kind, title, body) {
    statusEl.textContent = '';
    var box = document.createElement('div');
    box.className = 'alert alert-' + kind;
    var strong = document.createElement('strong');
    strong.textContent = title;
    box.appendChild(strong);
    if (body) {
      var p = document.createElement('p');
      p.textContent = body;
      box.appendChild(p);
    }
    statusEl.appendChild(box);
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    input.disabled = loading;
    pasteBtn.disabled = loading;
    spinner.hidden = !loading;
    submitLabel.textContent = loading ? 'Fetching…' : 'Get download links';
  }

  function clearResults() {
    resultsEl.hidden = true;
    ownerCard.textContent = '';
    captionEl.textContent = '';
    mediaGrid.textContent = '';
  }

  function updateClearButton() {
    clearBtn.disabled = input.value.trim().length === 0;
  }

  input.addEventListener('input', updateClearButton);
  updateClearButton();

  clearBtn.addEventListener('click', function () {
    input.value = '';
    pasteHint.hidden = true;
    clearResults();
    statusEl.textContent = '';
    updateClearButton();
    input.focus();
  });

  pasteBtn.addEventListener('click', async function () {
    pasteHint.hidden = true;
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      pasteHint.textContent = 'Clipboard paste is not available in this browser. Paste with Ctrl+V (or Cmd+V on Mac) instead.';
      pasteHint.hidden = false;
      input.focus();
      return;
    }
    try {
      var text = await navigator.clipboard.readText();
      if (text) {
        input.value = text.trim();
        updateClearButton();
        input.focus();
      } else {
        pasteHint.textContent = 'Your clipboard looks empty. Copy the Instagram link first, then tap Paste.';
        pasteHint.hidden = false;
      }
    } catch (err) {
      // Clipboard permission denied / unavailable (common on HTTP, in
      // iframes, or when the browser blocks it): say so, do not fail.
      pasteHint.textContent = 'This browser did not allow reading the clipboard. Paste with Ctrl+V (or Cmd+V on Mac) instead.';
      pasteHint.hidden = false;
      input.focus();
    }
  });

  // Keep the input focused for keyboard users; Enter submits via the form.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; updateClearButton(); }
  });

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function buildMediaCard(item, index) {
    var card = el('article', 'media-card');
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    card.setAttribute('aria-label', 'Media ' + (index + 1) + ' of ' + item.type);

    var preview = el('div', 'media-preview');
    if (item.type === 'video') {
      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = item.url;
      if (item.thumbnail) video.poster = item.thumbnail;
      video.setAttribute('aria-label', 'Video preview ' + (index + 1));
      preview.appendChild(video);
    } else {
      var img = document.createElement('img');
      img.src = item.url;
      img.alt = 'Photo ' + (index + 1);
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      preview.appendChild(img);
    }
    card.appendChild(preview);

    var body = el('div', 'media-body');
    var top = el('div', 'media-top');
    top.appendChild(el('span', 'badge', item.type === 'video' ? 'Video' : 'Photo'));
    var dims = item.width && item.height ? item.width + ' × ' + item.height : 'Original size';
    top.appendChild(el('span', 'media-dims', (index + 1) + ' · ' + dims));
    body.appendChild(top);

    var actions = el('div', 'media-actions');
    var dl = document.createElement('a');
    dl.className = 'btn btn-download';
    dl.href = item.downloadUrl;
    dl.target = '_blank';
    dl.rel = 'noopener noreferrer';
    dl.textContent = 'Download';
    dl.setAttribute('aria-label', 'Download ' + item.type + ' ' + (index + 1) + ' — opens in a new tab');
    actions.appendChild(dl);

    var copyBtn = el('button', 'btn btn-copy', 'Copy link');
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copy download link for ' + item.type + ' ' + (index + 1));
    actions.appendChild(copyBtn);
    body.appendChild(actions);

    var note = el('p', 'copied-note');
    body.appendChild(note);
    copyBtn.addEventListener('click', async function () {
      note.textContent = '';
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(item.downloadUrl);
          note.textContent = 'Link copied.';
        } else {
          throw new Error('clipboard unavailable');
        }
      } catch (err) {
        // Fallback: select-and-copy via a temporary input.
        var tmp = document.createElement('input');
        tmp.value = item.downloadUrl;
        tmp.setAttribute('aria-hidden', 'true');
        document.body.appendChild(tmp);
        tmp.select();
        try { document.execCommand('copy'); note.textContent = 'Link copied.'; }
        catch (e2) { note.textContent = 'Copy did not work — long-press the Download link instead.'; }
        document.body.removeChild(tmp);
      }
    });

    card.appendChild(body);
    return card;
  }

  function renderResults(data) {
    ownerCard.textContent = '';
    var name = el('span', 'owner-name', data.owner && data.owner.username ? '@' + data.owner.username : 'Instagram post');
    ownerCard.appendChild(name);
    if (data.owner && data.owner.isVerified) ownerCard.appendChild(el('span', 'verified', '✓ Verified'));
    if (data.owner && data.owner.fullName) ownerCard.appendChild(el('span', 'owner-meta', data.owner.fullName));
    if (typeof data.likes === 'number') ownerCard.appendChild(el('span', 'owner-meta', data.likes.toLocaleString() + ' likes'));
    ownerCard.appendChild(el('span', 'owner-meta', data.mediaCount + (data.mediaCount === 1 ? ' item' : ' items') + ' · ' + data.kind));

    captionEl.textContent = data.caption || '';
    mediaGrid.textContent = '';
    data.media.forEach(function (item, i) {
      mediaGrid.appendChild(buildMediaCard(item, i));
    });
    resultsEl.hidden = false;
    showStatus('success', 'Found ' + data.mediaCount + (data.mediaCount === 1 ? ' file' : ' files') + (data.cached ? ' (from cache)' : ''), 'Download each file below. Files open in a new tab from Instagram — save from there.');
    document.getElementById('results-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var url = input.value.trim();
    if (!url) {
      showStatus('error', 'Paste a link first', 'Copy a public Instagram Reel or post link and paste it above.');
      input.focus();
      return;
    }
    clearResults();
    setLoading(true);
    showStatus('info', 'Fetching…', 'Asking Instagram for this post. This usually takes a few seconds.');
    try {
      var res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || data.ok !== true) {
        var code = data && data.error && data.error.code;
        var friendly = FRIENDLY[code] || ['Something went wrong', (data && data.error && data.error.message) || 'Please try again.'];
        var extra = code === 'upstream_blocked'
          ? ' This is Instagram blocking the server right now — not a problem with your link.'
          : '';
        showStatus('error', friendly[0], friendly[1] + extra);
        return;
      }
      renderResults(data);
    } catch (err) {
      showStatus('error', 'Could not reach GrabInsta', 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  });
})();
