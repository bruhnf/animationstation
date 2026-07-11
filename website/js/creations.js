// AnimationStation — "My Creations" web dashboard.
//
// Lists the logged-in user's COMPLETED creations (Transform + Video) via
// GET /creations/history (presigned URLs, 20/page), MERGED with their Closet
// items (Design + Clean Up results — GET /api/closet, unpaginated, presigned)
// — same merge mobile's CreationsGrid does across /creations/history +
// /closet. Every card supports DOWNLOAD; creation cards additionally support
// CAPTION edit, PRIVACY toggle, and DELETE; closet cards support RENAME and
// DELETE (they have no privacy concept — Design/Clean Up items are always
// personal, never shown on the feed).
//
//   - DOWNLOAD   — fetch the presigned result as a blob and trigger a browser
//                  download (animationstation-<id>.<ext>).
//   - CAPTION    — inline edit via PATCH /creations/:id/title  { title }.
//   - PRIVACY    — toggle Public/Private via PATCH /creations/:id/privacy { isPrivate }.
//   - DELETE     — POST /creations/bulk-delete { jobIds:[id] } (creations) or
//                  DELETE /closet/:itemId (closet items), with a confirm.
//   - RENAME     — PATCH /closet/:itemId { name } (closet items only).
//
// Reuses helpers from auth.js (API_BASE, authFetch, getAccessToken, getUser, logout).
//
// VIDEO SUPPORT: /creations/history returns every completed job — images AND videos
// (no `kind` filter server-side). Video jobs carry kind === 'VIDEO', a presigned
// `videoUrl`, and a `sourceImageUrl` poster frame. We render those as a <video>
// player; images render as an <img>. Because history already merges videos in,
// we do NOT need a separate GET /api/video call here (that endpoint returns the
// same creations rows, just filtered to VIDEO — see videoController.getVideoHistory).
//
// MERGE STRATEGY: closet has no pagination (capped at 100 items server-side),
// so it's fetched once and combined with however many creation pages have
// loaded so far, re-sorted by date, and the grid is fully re-rendered on every
// load — simpler and cheap at these sizes than reconciling two independent
// paginated/incremental streams.
(function () {
  'use strict';

  // ---- Auth guard: bounce to login unless a real account is signed in ----
  // (a feed guest carries a token, but owns no creations)
  if (!isRealUser()) {
    window.location.href = '/login.html';
    return;
  }

  var page = 1;
  var PAGE_SIZE = 20; // matches the backend's fixed page size
  var creationJobs = [];
  var closetItems = [];
  var closetLoaded = false;

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([fetchCreationsPage(1), fetchCloset()]).then(renderAll);
  });

  async function fetchCreationsPage(p) {
    show('loadingMsg');
    hide('loadMoreBtn');
    try {
      var res = await authFetch(API_BASE + '/creations/history?page=' + p);
      if (!res.ok) throw new Error('Could not load your creations');
      var data = await res.json();
      var jobs = (data && data.jobs) || [];
      page = p;
      if (p === 1) creationJobs = jobs; else creationJobs = creationJobs.concat(jobs);
      // A full page means there may be more; a short page is the end.
      if (jobs.length === PAGE_SIZE) show('loadMoreBtn'); else hide('loadMoreBtn');
    } catch (err) {
      showError(err.message || 'Could not load your creations');
    } finally {
      hide('loadingMsg');
    }
  }

  async function fetchCloset() {
    if (closetLoaded) return;
    try {
      var res = await authFetch(API_BASE + '/closet');
      if (!res.ok) return; // non-fatal — the page still works with just creations
      var data = await res.json();
      closetItems = (data && data.items) || [];
      closetLoaded = true;
    } catch (e) { /* non-fatal */ }
  }

  function renderAll() {
    var grid = document.getElementById('grid');
    grid.innerHTML = '';
    var combined = creationJobs.map(function (j) { return { kind: 'creation', data: j, date: j.createdAt }; })
      .concat(closetItems.map(function (c) { return { kind: 'closet', data: c, date: c.createdAt }; }));
    combined.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    combined.forEach(function (entry) {
      if (entry.kind === 'creation') renderCard(entry.data);
      else renderClosetCard(entry.data);
    });
    if (!combined.length) show('emptyState'); else hide('emptyState');
  }

  window.loadMore = function () { fetchCreationsPage(page + 1).then(renderAll); };

  // Is this a video creation? Videos have kind === 'VIDEO' and/or a videoUrl.
  function isVideo(job) {
    return job.kind === 'VIDEO' || !!job.videoUrl;
  }

  // The best presigned URL for the actual result the user made.
  function resultUrl(job) {
    if (isVideo(job)) return job.videoUrl || null;
    return job.resultImageUrl || job.resultImage2Url || null;
  }

  // Poster / still image to show (video poster, or the image result itself).
  function posterUrl(job) {
    if (isVideo(job)) return job.sourceImageUrl || job.resultImageUrl || job.resultImage2Url || null;
    return job.resultImageUrl || job.resultImage2Url || null;
  }

  function renderCard(job) {
    var video = isVideo(job);
    var result = resultUrl(job);
    var poster = posterUrl(job);
    // A COMPLETE job should always have a result; skip anything unrenderable.
    if (!result && !poster) return;

    var card = document.createElement('div');
    card.className = 'creation-card';
    card.dataset.jobId = job.id;

    // ---- Media (image or video) ----
    var media = document.createElement('div');
    media.className = 'creation-media';

    if (video && result) {
      var vid = document.createElement('video');
      vid.src = result;
      if (poster) vid.poster = poster;
      vid.controls = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      media.appendChild(vid);
      media.appendChild(badge('kind-badge', 'Video'));
      media.appendChild(badge('ai-badge', '✨ AI-generated'));
    } else if (poster) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = job.title || 'AI creation';
      img.src = poster;
      // Tapping the image opens the full-screen viewer.
      media.onclick = function () { openViewer(poster, job.title); };
      media.appendChild(img);
      media.appendChild(badge('kind-badge', 'Image'));
      media.appendChild(badge('ai-badge', '✨ AI-generated'));
    } else {
      var ph = document.createElement('div');
      ph.className = 'media-empty';
      ph.textContent = 'Preview unavailable';
      media.appendChild(ph);
    }
    card.appendChild(media);

    // ---- Caption (click to edit) ----
    var cap = document.createElement('p');
    setCaption(cap, job.title);
    cap.title = 'Click to edit caption';
    cap.style.cursor = 'pointer';
    cap.onclick = function () { editCaption(job, cap); };
    card.appendChild(cap);

    // ---- Meta (date + privacy pill) ----
    var meta = document.createElement('div');
    meta.className = 'creation-meta';
    var date = document.createElement('span');
    date.className = 'creation-date';
    date.textContent = fmtDate(job.createdAt);
    var right = document.createElement('span');
    right.className = 'creation-meta-right';
    var pill = document.createElement('span');
    setPill(pill, job.isPrivate);
    right.appendChild(pill);
    meta.appendChild(date);
    meta.appendChild(right);
    card.appendChild(meta);

    // ---- Actions ----
    var actions = document.createElement('div');
    actions.className = 'creation-actions';

    var dlBtn = document.createElement('button');
    dlBtn.innerHTML = '&#8681; Download';
    dlBtn.onclick = function () { downloadResult(job, dlBtn); };

    var editBtn = document.createElement('button');
    editBtn.textContent = 'Edit caption';
    editBtn.onclick = function () { editCaption(job, cap); };

    var toggleBtn = document.createElement('button');
    toggleBtn.textContent = job.isPrivate ? 'Make public' : 'Make private';
    toggleBtn.onclick = function () { togglePrivacy(job, pill, toggleBtn); };

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-mini-danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = function () { deleteJob(job, card, delBtn); };

    actions.appendChild(dlBtn);
    actions.appendChild(editBtn);
    actions.appendChild(toggleBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    document.getElementById('grid').appendChild(card);
  }

  // ---- Closet card (Design / Clean Up results — always personal, no privacy toggle) ----
  function renderClosetCard(item) {
    if (!item.imageUrl) return;

    var card = document.createElement('div');
    card.className = 'creation-card';
    card.dataset.closetId = item.id;

    var media = document.createElement('div');
    media.className = 'creation-media';
    var img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = item.name || 'AI creation';
    img.src = item.imageUrl;
    media.onclick = function () { openViewer(item.imageUrl, item.name); };
    media.appendChild(img);
    media.appendChild(badge('kind-badge', 'Closet'));
    media.appendChild(badge('ai-badge', '✨ AI-generated'));
    card.appendChild(media);

    var cap = document.createElement('p');
    cap.className = 'creation-caption';
    cap.textContent = item.name || 'Untitled';
    cap.title = 'Click to rename';
    cap.style.cursor = 'pointer';
    cap.onclick = function () { renameClosetItem(item, cap); };
    card.appendChild(cap);

    var meta = document.createElement('div');
    meta.className = 'creation-meta';
    var date = document.createElement('span');
    date.className = 'creation-date';
    date.textContent = fmtDate(item.createdAt);
    var right = document.createElement('span');
    right.className = 'creation-meta-right';
    right.appendChild(badge('pill pill-closet', 'Closet'));
    meta.appendChild(date);
    meta.appendChild(right);
    card.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'creation-actions';

    var dlBtn = document.createElement('button');
    dlBtn.innerHTML = '&#8681; Download';
    dlBtn.onclick = function () { downloadClosetItem(item, dlBtn); };

    var renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.onclick = function () { renameClosetItem(item, cap); };

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-mini-danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = function () { deleteClosetItem(item, card, delBtn); };

    actions.appendChild(dlBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    document.getElementById('grid').appendChild(card);
  }

  async function downloadClosetItem(item, btn) {
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.textContent = 'Downloading…';
    try {
      var res = await fetch(item.imageUrl); // presigned S3 URL — public read, CORS-enabled
      if (!res.ok) throw new Error('Could not download this item');
      var blob = await res.blob();
      var objUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objUrl;
      a.download = 'animationstation-' + item.id + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      showError(err.message || 'Download failed');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  async function renameClosetItem(item, capEl) {
    var current = item.name || '';
    var next = prompt('Rename this item:', current);
    if (next === null) return; // cancelled
    next = next.trim();
    if (!next || next === current) return;
    try {
      var res = await authFetch(API_BASE + '/closet/' + item.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error('Could not rename this item');
      var data = await res.json().catch(function () { return {}; });
      var saved = (data && typeof data.name === 'string') ? data.name : next;
      item.name = saved;
      capEl.textContent = saved;
      showSuccess('Renamed.');
    } catch (err) {
      showError(err.message);
    }
  }

  async function deleteClosetItem(item, card, btn) {
    if (!confirm('Delete this item permanently? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/closet/' + item.id, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete this item');
      card.remove();
      closetItems = closetItems.filter(function (c) { return c.id !== item.id; });
      if (!document.getElementById('grid').children.length && !creationJobs.length) show('emptyState');
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  }

  function badge(cls, text) {
    var el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function setCaption(el, title) {
    el.className = 'creation-caption' + (title ? '' : ' empty');
    el.textContent = title ? title : 'Add a caption…';
  }

  // ---- Download (fetch presigned result as a blob → browser download) ----
  async function downloadResult(job, btn) {
    var url = resultUrl(job);
    if (!url) { showError('This creation has no downloadable result.'); return; }
    var ext = isVideo(job) ? 'mp4' : 'jpg';
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.textContent = 'Downloading…';
    try {
      // Presigned S3 URLs are public reads (no auth header needed) and CORS-enabled.
      var res = await fetch(url);
      if (!res.ok) throw new Error('Could not download this creation');
      var blob = await res.blob();
      var objUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objUrl;
      a.download = 'animationstation-' + job.id + '.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      showError(err.message || 'Download failed');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ---- Edit caption (PATCH /creations/:id/title { title }) ----
  async function editCaption(job, capEl) {
    var current = job.title || '';
    var next = prompt('Edit caption (leave blank to remove):', current);
    if (next === null) return;        // cancelled
    next = next.trim();
    if (next === current) return;     // no change
    try {
      var res = await authFetch(API_BASE + '/creations/' + job.id + '/title', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error('Could not update the caption');
      // Prefer the server's sanitized value if it echoes one back.
      var data = await res.json().catch(function () { return {}; });
      var saved = (data && typeof data.title === 'string') ? data.title : next;
      job.title = saved;
      setCaption(capEl, saved);
      showSuccess('Caption updated.');
    } catch (err) {
      showError(err.message);
    }
  }

  function setPill(pill, isPrivate) {
    pill.className = 'pill ' + (isPrivate ? 'pill-no' : 'pill-ok');
    pill.textContent = isPrivate ? 'Private' : 'Public';
  }

  async function togglePrivacy(job, pill, btn) {
    var target = !job.isPrivate;
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/creations/' + job.id + '/privacy', {
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
    if (!confirm('Delete this creation permanently? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/creations/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [job.id] }),
      });
      if (!res.ok) throw new Error('Could not delete this creation');
      card.remove();
      // Only declare "no creations" if there are no more pages to load —
      // deleting the last card on screen doesn't mean the account is empty.
      var moreAvailable = !document.getElementById('loadMoreBtn').classList.contains('hidden');
      if (!document.getElementById('grid').children.length && !moreAvailable) show('emptyState');
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  }

  // ---- Full-screen viewer (images only; videos play inline in the card) ----
  function openViewer(url, caption) {
    if (!url) return;

    var box = document.createElement('div');
    box.className = 'carousel';
    box.innerHTML =
      '<button class="car-close" aria-label="Close">&times;</button>' +
      '<figure class="car-figure">' +
        '<img alt="">' +
        '<span class="ai-badge">✨ AI-generated</span>' +
        '<figcaption class="car-caption"></figcaption>' +
      '</figure>';

    box.querySelector('.car-figure img').src = url;
    box.querySelector('.car-figure img').alt = caption || 'AI creation';
    box.querySelector('.car-caption').textContent = caption || 'AI creation';

    function close() { box.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    box.querySelector('.car-close').onclick = function (e) { e.stopPropagation(); close(); };
    box.onclick = function (e) { if (e.target === box) close(); };
    document.addEventListener('keydown', onKey);

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
  function showSuccess(msg) {
    var el = document.getElementById('successMsg');
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(function () { el.classList.remove('visible'); }, 3000);
  }
})();
