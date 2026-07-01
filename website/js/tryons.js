// TryOn Mirror — "My Try-Ons" web dashboard.
// Lists the logged-in user's COMPLETE try-on sessions (GET /tryon/history,
// presigned image URLs, 20/page), with privacy toggle (PATCH /tryon/:id/privacy)
// and delete (POST /tryon/bulk-delete with a single id). Reuses helpers from
// auth.js (API_BASE, authFetch, getAccessToken, getUser, logout).
//
// Each card shows only TWO thumbnails — the user's body photo and the clothing
// item that went in. Tapping either opens a full-screen carousel of EVERY image
// in that session (both inputs and the AI results), navigable with arrows / keys.
(function () {
  'use strict';

  // ---- Auth guard: bounce to login if there's no session ----
  if (!getAccessToken() || !getUser()) {
    window.location.href = '/login.html';
    return;
  }

  var page = 1;
  var PAGE_SIZE = 20; // matches the backend's fixed page size
  var loadedAny = false;

  document.addEventListener('DOMContentLoaded', function () { fetchPage(1); });

  async function fetchPage(p) {
    show('loadingMsg');
    hide('loadMoreBtn');
    try {
      var res = await authFetch(API_BASE + '/tryon/history?page=' + p);
      if (!res.ok) throw new Error('Could not load your try-ons');
      var data = await res.json();
      var jobs = (data && data.jobs) || [];
      page = p;
      jobs.forEach(renderCard);
      loadedAny = loadedAny || jobs.length > 0;

      if (!loadedAny) show('emptyState');
      // A full page means there may be more; a short page is the end.
      if (jobs.length === PAGE_SIZE) show('loadMoreBtn');
    } catch (err) {
      showError(err.message || 'Could not load your try-ons');
    } finally {
      hide('loadingMsg');
    }
  }

  window.loadMore = function () { fetchPage(page + 1); };

  // Build the ordered list of EVERY image in a session: inputs first (the user's
  // own body + clothing photos, no AI badge), then the AI results (badged). This
  // is what the carousel pages through. bodyPhotoUrl/clothing2 can be absent on
  // older sessions — the list simply skips what isn't there.
  function collectImages(job) {
    var all = [];
    if (job.bodyPhotoUrl) all.push({ url: job.bodyPhotoUrl, label: 'Your photo', ai: false });
    if (job.clothingPhoto1Url) all.push({ url: job.clothingPhoto1Url, label: 'Clothing', ai: false });
    if (job.clothingPhoto2Url) all.push({ url: job.clothingPhoto2Url, label: 'Clothing 2', ai: false });
    if (job.resultFullBodyUrl) all.push({ url: job.resultFullBodyUrl, label: 'Full body result', ai: true });
    if (job.resultMediumUrl) all.push({ url: job.resultMediumUrl, label: 'Waist up result', ai: true });
    return all;
  }

  function renderCard(job) {
    var images = collectImages(job);
    // A COMPLETE job always has at least one result, but be safe.
    if (!images.length) return;

    var card = document.createElement('div');
    card.className = 'tryon-card';
    card.dataset.jobId = job.id;

    // ---- The two input thumbnails: body photo + clothing item ----
    // Tapping either opens the carousel showing ALL images for the session.
    var thumbs = document.createElement('div');
    thumbs.className = 'tryon-thumbs';

    var thumbSpecs = [
      { url: job.bodyPhotoUrl, label: 'Your photo' },
      { url: job.clothingPhoto1Url, label: 'Clothing' },
    ];
    thumbSpecs.forEach(function (spec) {
      var wrap = document.createElement('div');
      wrap.className = 'tryon-imgwrap';
      if (spec.url) {
        wrap.innerHTML = '<img loading="lazy" alt=""><span class="img-label"></span>' +
          '<span class="thumb-hint">Tap to view all</span>';
        wrap.querySelector('img').src = spec.url;
        wrap.querySelector('img').alt = spec.label;
        wrap.querySelector('.img-label').textContent = spec.label;
        // Open the carousel positioned on this image within the full set.
        wrap.onclick = function () { openCarousel(images, indexOfUrl(images, spec.url)); };
      } else {
        // Legacy sessions may lack a stored body photo — show a placeholder that
        // still opens the carousel.
        wrap.className += ' tryon-imgwrap-empty';
        wrap.textContent = spec.label + ' n/a';
        wrap.onclick = function () { openCarousel(images, 0); };
      }
      thumbs.appendChild(wrap);
    });
    card.appendChild(thumbs);

    // ---- Optional user caption ----
    if (job.title) {
      var cap = document.createElement('p');
      cap.className = 'tryon-caption';
      cap.textContent = job.title; // textContent = no HTML injection
      card.appendChild(cap);
    }

    // ---- Meta (date + privacy pill) ----
    var meta = document.createElement('div');
    meta.className = 'tryon-meta';
    var date = document.createElement('span');
    date.className = 'tryon-date';
    date.textContent = fmtDate(job.createdAt);
    var pill = document.createElement('span');
    setPill(pill, job.isPrivate);
    meta.appendChild(date);
    meta.appendChild(pill);
    card.appendChild(meta);

    // ---- Actions (privacy toggle + delete) ----
    var actions = document.createElement('div');
    actions.className = 'tryon-actions';
    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn-mini-ghost';
    viewBtn.textContent = 'View all (' + images.length + ')';
    viewBtn.onclick = function () { openCarousel(images, 0); };
    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-mini-ghost';
    toggleBtn.textContent = job.isPrivate ? 'Make public' : 'Make private';
    toggleBtn.onclick = function () { togglePrivacy(job, pill, toggleBtn); };
    var delBtn = document.createElement('button');
    delBtn.className = 'btn-mini-danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = function () { deleteJob(job, card, delBtn); };
    actions.appendChild(viewBtn);
    actions.appendChild(toggleBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    document.getElementById('grid').appendChild(card);
  }

  function indexOfUrl(images, url) {
    for (var i = 0; i < images.length; i++) { if (images[i].url === url) return i; }
    return 0;
  }

  function setPill(pill, isPrivate) {
    pill.className = 'pill ' + (isPrivate ? 'pill-no' : 'pill-ok');
    pill.textContent = isPrivate ? 'Private' : 'Public';
  }

  async function togglePrivacy(job, pill, btn) {
    var target = !job.isPrivate;
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/tryon/' + job.id + '/privacy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: target }),
      });
      if (!res.ok) throw new Error('Could not update privacy');
      job.isPrivate = target;
      setPill(pill, target);
      btn.textContent = target ? 'Make public' : 'Make private';
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteJob(job, card, btn) {
    if (!confirm('Delete this try-on session permanently? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/tryon/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [job.id] }),
      });
      if (!res.ok) throw new Error('Could not delete this session');
      card.remove();
      // Only declare "no try-ons" if there are no more pages to load —
      // deleting the last card on screen doesn't mean the account is empty.
      var moreAvailable = !document.getElementById('loadMoreBtn').classList.contains('hidden');
      if (!document.getElementById('grid').children.length && !moreAvailable) show('emptyState');
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  }

  // ---- Carousel ----
  // A full-screen modal that pages through every image in one session. Results
  // carry the ✨ AI-generated badge (Guideline 4.0 parity with the app); the
  // user's own input photos do not.
  function openCarousel(images, startIndex) {
    if (!images || !images.length) return;
    var idx = startIndex || 0;

    var box = document.createElement('div');
    box.className = 'carousel';
    box.innerHTML =
      '<button class="car-close" aria-label="Close">&times;</button>' +
      '<button class="car-nav car-prev" aria-label="Previous">&#10094;</button>' +
      '<figure class="car-figure">' +
        '<img alt="">' +
        '<span class="ai-badge hidden">✨ AI-generated</span>' +
        '<figcaption class="car-caption"></figcaption>' +
      '</figure>' +
      '<button class="car-nav car-next" aria-label="Next">&#10095;</button>' +
      '<div class="car-counter"></div>';

    var imgEl = box.querySelector('.car-figure img');
    var badgeEl = box.querySelector('.ai-badge');
    var capEl = box.querySelector('.car-caption');
    var counterEl = box.querySelector('.car-counter');

    function paint() {
      var item = images[idx];
      imgEl.src = item.url;
      imgEl.alt = item.label;
      capEl.textContent = item.label;
      badgeEl.classList.toggle('hidden', !item.ai);
      counterEl.textContent = (idx + 1) + ' / ' + images.length;
    }
    function go(delta) { idx = (idx + delta + images.length) % images.length; paint(); }
    function close() {
      box.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    }

    box.querySelector('.car-prev').onclick = function (e) { e.stopPropagation(); go(-1); };
    box.querySelector('.car-next').onclick = function (e) { e.stopPropagation(); go(1); };
    box.querySelector('.car-close').onclick = function (e) { e.stopPropagation(); close(); };
    // Click on the backdrop (not the image / controls) closes.
    box.onclick = function (e) { if (e.target === box) close(); };
    document.addEventListener('keydown', onKey);

    // Hide the prev/next chrome when there's only one image.
    if (images.length < 2) {
      box.querySelector('.car-prev').classList.add('hidden');
      box.querySelector('.car-next').classList.add('hidden');
    }

    paint();
    document.body.appendChild(box);
  }

  // ---- small helpers ----
  function fmtDate(s) {
    try {
      return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }
  function show(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hide(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  function showError(msg) {
    var el = document.getElementById('errorMsg');
    el.textContent = msg;
    el.classList.add('visible');
    window.scrollTo(0, 0);
  }
})();
