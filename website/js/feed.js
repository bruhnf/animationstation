// AnimationStation — immersive web feed.
//
// Mirrors the mobile Home/Discover feed: a full-viewport snap-scroll of random
// public creations from the whole user population (GET /api/feed, 20/page,
// infinite scroll). Videos autoplay muted when on-screen and share ONE mute
// preference across the session (un-mute once → audio stays on), exactly like
// the app's useFeedAudioStore. Each post has a like / comment / share / save /
// ⋯ rail; comments open in a bottom sheet; search + profiles slide in from the
// right. Everything writes to the same backend + DB as the mobile app.
//
// Auth model: the feed needs a token, so an anonymous visitor is given a guest
// session (POST /api/auth/guest, no welcome credits). Guests can browse; liking,
// commenting, following, and saving require a real account and prompt sign-up.
//
// Reuses auth.js (API_BASE, setTokens, setUser, getUser, getAccessToken,
// authFetch, logout).
(function () {
  'use strict';

  var PAGE_SIZE = 20;
  var state = {
    page: 0,
    hasMore: true,
    loading: false,
    muted: true, // shared across all feed videos this session (starts muted)
    posts: [], // rendered job objects (for lookup by id)
    me: null, // current user (real or guest)
  };
  var players = {}; // jobId -> <video> element
  var activeId = null;

  var $ = function (id) { return document.getElementById(id); };
  var scrollEl, footerEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    scrollEl = $('feedScroll');
    renderBanner();
    try {
      await ensureSession();
    } catch (e) {
      showFeedStatus('Could not start a session. Please refresh.', true);
      return;
    }
    state.me = getUser();
    renderBanner();
    bindEndSentinel();
    await loadMore();
  }

  // ---- Session bootstrap ----
  async function ensureSession() {
    if (getAccessToken() && getUser()) return; // already logged in (real or guest)
    var deviceId = localStorage.getItem('webDeviceId');
    if (!deviceId) {
      deviceId = 'web-' + (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      localStorage.setItem('webDeviceId', deviceId);
    }
    var res = await fetch(API_BASE + '/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // welcomeCredits:false — a browsing guest shouldn't be handed a credit grant.
      body: JSON.stringify({ deviceId: deviceId, welcomeCredits: false }),
    });
    if (!res.ok) throw new Error('guest session failed');
    var data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }

  function isRealUser() {
    var u = getUser();
    return !!(u && !u.isGuest);
  }
  // Gate a social write behind a real account. Returns true if allowed.
  function requireReal(msg) {
    if (isRealUser()) return true;
    if (confirm((msg || 'Create a free account to do that.') + '\n\nGo to sign up now?')) {
      window.location.href = '/signup.html';
    }
    return false;
  }
  function myUsername() {
    var u = getUser();
    return u ? u.username : null;
  }

  // ---- Top banner (auth-aware) ----
  function renderBanner() {
    var right = $('bannerRight');
    if (!right) return;
    if (isRealUser()) {
      var u = getUser();
      right.innerHTML =
        '<a class="banner-link banner-hide-sm" href="/create.html">Create</a>' +
        '<a class="banner-link banner-hide-sm" href="/creations.html">My Creations</a>' +
        '<button class="banner-icon-btn" title="Search" onclick="Feed.openSearch()">&#128269;</button>' +
        '<span class="banner-greeting">Hi, ' + escapeHtml(u.firstName || u.username) + '</span>' +
        '<a class="banner-ghost banner-hide-sm" href="/account.html">Account</a>' +
        '<button class="banner-ghost" onclick="logout()">Log out</button>';
    } else {
      right.innerHTML =
        '<button class="banner-icon-btn" title="Search" onclick="Feed.openSearch()">&#128269;</button>' +
        '<a class="banner-cta" href="/signup.html">Sign Up</a>' +
        '<a class="banner-ghost" href="/login.html">Log In</a>';
    }
  }

  // ---- Feed fetch + render ----
  function bindEndSentinel() {
    // Load the next page as the end sentinel scrolls near view.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && state.hasMore && !state.loading) loadMore();
      });
    }, { root: scrollEl, threshold: 0.1 });
    var sentinel = $('feedEndSentinel');
    if (sentinel) io.observe(sentinel);
  }

  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    if (state.page === 0) showFeedStatus('', false, true);
    try {
      var next = state.page + 1;
      var res = await authFetch(API_BASE + '/feed?page=' + next);
      if (!res.ok) throw new Error('feed load failed');
      var data = await res.json();
      var jobs = (data && data.jobs) || [];
      state.page = next;
      state.hasMore = data.hasMore != null ? data.hasMore : jobs.length === PAGE_SIZE;
      clearFeedStatus();
      jobs.forEach(function (job) {
        state.posts.push(job);
        scrollEl.insertBefore(renderPost(job), $('feedEndSentinel'));
      });
      if (state.posts.length === 0) showEmpty();
      observeActive();
    } catch (e) {
      if (state.posts.length === 0) showFeedStatus('Couldn’t load the feed.', true);
    } finally {
      state.loading = false;
    }
  }

  function isVideo(job) { return job.kind === 'VIDEO' || !!job.videoUrl; }
  function resultUrl(job) { return isVideo(job) ? job.videoUrl : (job.resultImageUrl || job.resultImage2Url); }
  function posterUrl(job) { return isVideo(job) ? (job.sourceImageUrl || job.resultImageUrl) : (job.resultImageUrl || job.resultImage2Url); }

  function renderPost(job) {
    var post = document.createElement('div');
    post.className = 'feed-post';
    post.dataset.jobId = job.id;

    // Media
    if (isVideo(job) && job.videoUrl) {
      var v = document.createElement('video');
      v.className = 'feed-media video';
      v.src = job.videoUrl;
      if (job.sourceImageUrl) v.poster = job.sourceImageUrl;
      v.loop = true;
      v.muted = state.muted;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'metadata';
      v.addEventListener('click', function () { togglePlay(job.id); });
      players[job.id] = v;
      post.appendChild(v);

      var play = document.createElement('div');
      play.className = 'play-overlay';
      play.style.display = 'none';
      play.innerHTML = '<span>&#9658;</span>';
      post.appendChild(play);

      var mute = document.createElement('button');
      mute.className = 'mute-btn';
      mute.innerHTML = state.muted ? '&#128263;' : '&#128266;';
      mute.title = state.muted ? 'Unmute' : 'Mute';
      mute.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
      post.appendChild(mute);
    } else {
      var img = document.createElement('img');
      img.className = 'feed-media';
      img.loading = 'lazy';
      img.alt = job.title || 'AI creation';
      img.src = posterUrl(job) || '';
      post.appendChild(img);
    }

    // Scrim + AI badge
    var scrim = document.createElement('div');
    scrim.className = 'post-scrim';
    post.appendChild(scrim);
    var badge = document.createElement('span');
    badge.className = 'ai-badge';
    badge.innerHTML = '&#10024; AI-generated';
    post.appendChild(badge);

    // Creator + caption
    post.appendChild(renderCreator(job));

    // Action rail
    post.appendChild(renderRail(job));
    return post;
  }

  function renderCreator(job) {
    var wrap = document.createElement('div');
    wrap.className = 'post-creator';
    var name = fullName(job.user) || ('@' + job.user.username);

    var row = document.createElement('div');
    row.className = 'creator-row';
    row.onclick = function () { openProfile(job.user.username); };
    row.appendChild(avatarEl(job.user.avatarUrl, job.user.username, 'creator-avatar'));
    var nm = document.createElement('span');
    nm.className = 'creator-name';
    nm.textContent = name;
    row.appendChild(nm);
    wrap.appendChild(row);

    if (job.title) {
      var cap = document.createElement('div');
      cap.className = 'post-caption';
      cap.textContent = job.title;
      wrap.appendChild(cap);
    } else if (isVideo(job) && job.motionPrompt) {
      var pr = document.createElement('div');
      pr.className = 'post-caption prompt';
      pr.textContent = 'Prompt: ' + job.motionPrompt;
      wrap.appendChild(pr);
    }
    return wrap;
  }

  function renderRail(job) {
    var rail = document.createElement('div');
    rail.className = 'post-rail';

    // Like
    var like = railBtn(job.liked ? '❤' : '♡', job.likesCount, 'like-btn');
    if (job.liked) like.classList.add('liked');
    like.onclick = function () { toggleLike(job, like); };
    rail.appendChild(like);

    // Comment
    var comment = railBtn('💬', job.commentsCount, 'comment-btn');
    comment.onclick = function () { openComments(job); };
    rail.appendChild(comment);

    // Share
    var share = railBtn('↪', null, 'share-btn');
    share.onclick = function () { shareJob(job); };
    rail.appendChild(share);

    // Save
    var save = railBtn(job.saved ? '🔖' : '🤍', null, 'save-btn');
    if (job.saved) save.classList.add('saved');
    save.querySelector('.rail-icon').innerHTML = job.saved ? '&#128278;' : '&#128278;';
    save.onclick = function () { toggleSave(job, save); };
    rail.appendChild(save);

    // More
    var more = railBtn('⋯', null, 'more-btn');
    more.onclick = function (e) { openPostMenu(job, e); };
    rail.appendChild(more);
    return rail;
  }

  function railBtn(icon, count, cls) {
    var b = document.createElement('button');
    b.className = 'rail-btn ' + (cls || '');
    var ic = document.createElement('span');
    ic.className = 'rail-icon';
    ic.textContent = icon;
    b.appendChild(ic);
    var c = document.createElement('span');
    c.className = 'rail-count';
    c.textContent = count && count > 0 ? String(count) : '';
    b.appendChild(c);
    return b;
  }

  // ---- Active post detection → video autoplay ----
  var activeObserver = null;
  function observeActive() {
    if (!activeObserver) {
      activeObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && en.intersectionRatio >= 0.8) {
            setActive(en.target.dataset.jobId);
          }
        });
      }, { root: scrollEl, threshold: [0.8] });
    }
    // Observe any posts not yet observed.
    Array.prototype.forEach.call(scrollEl.querySelectorAll('.feed-post'), function (el) {
      if (!el.dataset.observed) { el.dataset.observed = '1'; activeObserver.observe(el); }
    });
  }

  function setActive(jobId) {
    if (activeId === jobId) return;
    activeId = jobId;
    Object.keys(players).forEach(function (id) {
      var v = players[id];
      if (!v) return;
      if (id === jobId) {
        v.muted = state.muted;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
        setPlayOverlay(id, false);
      } else {
        try { v.pause(); } catch (e) {}
      }
    });
  }

  function togglePlay(jobId) {
    var v = players[jobId];
    if (!v) return;
    if (v.paused) { v.play().catch(function () {}); setPlayOverlay(jobId, false); }
    else { v.pause(); setPlayOverlay(jobId, true); }
  }
  function setPlayOverlay(jobId, show) {
    var post = scrollEl.querySelector('.feed-post[data-job-id="' + cssEsc(jobId) + '"]');
    if (!post) return;
    var ov = post.querySelector('.play-overlay');
    if (ov) ov.style.display = show ? 'flex' : 'none';
  }

  function toggleMute() {
    state.muted = !state.muted;
    Object.keys(players).forEach(function (id) {
      var v = players[id];
      if (v) { try { v.muted = state.muted; } catch (e) {} }
    });
    // Update every mute button icon in lockstep.
    Array.prototype.forEach.call(scrollEl.querySelectorAll('.mute-btn'), function (b) {
      b.innerHTML = state.muted ? '&#128263;' : '&#128266;';
      b.title = state.muted ? 'Unmute' : 'Mute';
    });
  }

  // ---- Like / Save / Share ----
  async function toggleLike(job, btn) {
    if (!requireReal('Sign up to like creations.')) return;
    if (job.user.username === myUsername()) { toast("You can't like your own post."); return; }
    var target = !job.liked;
    // optimistic
    job.liked = target;
    job.likesCount = Math.max(0, (job.likesCount || 0) + (target ? 1 : -1));
    paintLike(job, btn);
    try {
      var res = await authFetch(API_BASE + '/likes/' + job.id, { method: target ? 'POST' : 'DELETE' });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        if (d.error === 'GUEST_SIGNUP_REQUIRED') { revertLike(job, btn, target); return requireReal('Sign up to like creations.'); }
        if (res.status === 409 || res.status === 404) return; // already in desired-ish state
        throw new Error();
      }
    } catch (e) {
      revertLike(job, btn, target);
      toast('Could not update like.');
    }
  }
  function paintLike(job, btn) {
    btn.classList.toggle('liked', job.liked);
    btn.querySelector('.rail-icon').textContent = job.liked ? '❤' : '♡';
    btn.querySelector('.rail-count').textContent = job.likesCount > 0 ? String(job.likesCount) : '';
  }
  function revertLike(job, btn, wasTarget) {
    job.liked = !wasTarget;
    job.likesCount = Math.max(0, (job.likesCount || 0) + (wasTarget ? -1 : 1));
    paintLike(job, btn);
  }

  async function toggleSave(job, btn) {
    if (!requireReal('Sign up to save creations.')) return;
    var target = !job.saved;
    job.saved = target;
    btn.classList.toggle('saved', target);
    try {
      var res = await authFetch(API_BASE + '/looks/' + job.id, { method: target ? 'POST' : 'DELETE' });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        if (d.error === 'GUEST_SIGNUP_REQUIRED') { job.saved = !target; btn.classList.toggle('saved', !target); return requireReal('Sign up to save creations.'); }
        throw new Error();
      }
      toast(target ? 'Saved' : 'Removed from saved');
    } catch (e) {
      job.saved = !target;
      btn.classList.toggle('saved', !target);
      toast('Could not update saved.');
    }
  }

  async function shareJob(job) {
    var url = window.location.origin + '/t/' + job.id;
    try {
      if (navigator.share) { await navigator.share({ title: 'AnimationStation', url: url }); return; }
    } catch (e) { return; }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch (e) { window.prompt('Copy this link:', url); }
  }

  // ---- Comments bottom sheet ----
  var commentJob = null;
  var replyTarget = null;

  async function openComments(job) {
    commentJob = job;
    replyTarget = null;
    var ov = $('commentsOverlay');
    ov.classList.remove('hidden');
    $('commentsBody').innerHTML = '<div class="comment-empty">Loading…</div>';
    updateReplyHint();
    try {
      var res = await authFetch(API_BASE + '/creations/' + job.id + '/comments?page=1');
      if (!res.ok) throw new Error();
      var data = await res.json();
      renderComments(data.comments || []);
    } catch (e) {
      $('commentsBody').innerHTML = '<div class="comment-empty">Could not load comments.</div>';
    }
  }
  window.Feed = window.Feed || {};
  window.Feed.closeComments = function () {
    $('commentsOverlay').classList.add('hidden');
    commentJob = null; replyTarget = null;
  };

  function renderComments(list) {
    var body = $('commentsBody');
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<div class="comment-empty">No comments yet. Be the first!</div>'; return; }
    list.forEach(function (c) {
      body.appendChild(commentRow(c, false));
      (c.replies || []).forEach(function (r) { body.appendChild(commentRow(r, true)); });
    });
  }

  function commentRow(c, isReply) {
    var row = document.createElement('div');
    row.className = 'comment' + (isReply ? ' reply' : '');
    row.dataset.commentId = c.id;
    row.appendChild(avatarEl(c.user.avatarUrl, c.user.username, 'comment-avatar'));

    var main = document.createElement('div');
    main.className = 'comment-main';
    var head = document.createElement('div');
    head.innerHTML = '<span class="comment-name">' + escapeHtml(fullName(c.user) || ('@' + c.user.username)) +
      '</span><span class="comment-time">' + timeAgo(c.createdAt) + '</span>';
    main.appendChild(head);
    var bodyText = document.createElement('div');
    bodyText.className = 'comment-body';
    bodyText.textContent = c.body;
    main.appendChild(bodyText);

    var actions = document.createElement('div');
    actions.className = 'comment-actions';
    var likeBtn = document.createElement('button');
    likeBtn.className = 'comment-like' + (c.liked ? ' liked' : '');
    likeBtn.textContent = (c.liked ? '❤ ' : '♡ ') + (c.likesCount > 0 ? c.likesCount : 'Like');
    likeBtn.onclick = function () { toggleCommentLike(c, likeBtn); };
    actions.appendChild(likeBtn);
    if (!isReply) {
      var replyBtn = document.createElement('button');
      replyBtn.textContent = 'Reply';
      replyBtn.onclick = function () { startReply(c); };
      actions.appendChild(replyBtn);
    }
    if (canDeleteComment(c)) {
      var del = document.createElement('button');
      del.textContent = 'Delete';
      del.onclick = function () { deleteComment(c, row); };
      actions.appendChild(del);
    }
    main.appendChild(actions);
    row.appendChild(main);
    return row;
  }

  function canDeleteComment(c) {
    if (!isRealUser()) return false;
    var me = myUsername();
    return c.user.username === me || (commentJob && commentJob.user.username === me);
  }

  async function toggleCommentLike(c, btn) {
    if (!requireReal('Sign up to like comments.')) return;
    var target = !c.liked;
    c.liked = target;
    c.likesCount = Math.max(0, (c.likesCount || 0) + (target ? 1 : -1));
    btn.className = 'comment-like' + (target ? ' liked' : '');
    btn.textContent = (target ? '❤ ' : '♡ ') + (c.likesCount > 0 ? c.likesCount : 'Like');
    try {
      var res = await authFetch(API_BASE + '/comments/' + c.id + '/likes', { method: target ? 'POST' : 'DELETE' });
      if (!res.ok) throw new Error();
    } catch (e) {
      c.liked = !target;
      c.likesCount = Math.max(0, (c.likesCount || 0) + (target ? -1 : 1));
      btn.className = 'comment-like' + (c.liked ? ' liked' : '');
      btn.textContent = (c.liked ? '❤ ' : '♡ ') + (c.likesCount > 0 ? c.likesCount : 'Like');
    }
  }

  function startReply(c) {
    replyTarget = c;
    updateReplyHint();
    $('commentInput').focus();
  }
  function updateReplyHint() {
    var hint = $('replyHint');
    if (replyTarget) {
      hint.classList.remove('hidden');
      hint.querySelector('span').textContent = 'Replying to @' + replyTarget.user.username;
    } else {
      hint.classList.add('hidden');
    }
  }
  window.Feed.cancelReply = function () { replyTarget = null; updateReplyHint(); };

  window.Feed.postComment = async function () {
    if (!commentJob) return;
    if (!requireReal('Sign up to join the conversation.')) return;
    var input = $('commentInput');
    var body = input.value.trim();
    if (!body) return;
    var send = $('commentSend');
    send.disabled = true;
    try {
      var payload = { body: body };
      if (replyTarget) payload.parentId = replyTarget.id;
      var res = await authFetch(API_BASE + '/creations/' + commentJob.id + '/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (data.error === 'GUEST_SIGNUP_REQUIRED') { requireReal('Sign up to comment.'); return; }
        toast(data.message || 'Could not post comment.'); return;
      }
      input.value = '';
      // Bump the post's comment count + rail.
      commentJob.commentsCount = (commentJob.commentsCount || 0) + 1;
      repaintRailCount(commentJob.id, 'comment-btn', commentJob.commentsCount);
      // Re-fetch to render in-order with threading.
      var listRes = await authFetch(API_BASE + '/creations/' + commentJob.id + '/comments?page=1');
      var listData = await listRes.json();
      renderComments(listData.comments || []);
      replyTarget = null; updateReplyHint();
      $('commentsBody').scrollTop = $('commentsBody').scrollHeight;
    } catch (e) {
      toast('Could not post comment.');
    } finally {
      send.disabled = false;
    }
  };

  async function deleteComment(c, row) {
    if (!confirm('Delete this comment?')) return;
    try {
      var res = await authFetch(API_BASE + '/comments/' + c.id, { method: 'DELETE' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error();
      row.remove();
      // Remove any rendered replies of a deleted top-level comment.
      Array.prototype.forEach.call($('commentsBody').querySelectorAll('.comment.reply'), function (el) {
        // best-effort: leave replies; server cascade handles counts
      });
      var removed = data.removed || 1;
      if (commentJob) {
        commentJob.commentsCount = Math.max(0, (commentJob.commentsCount || 0) - removed);
        repaintRailCount(commentJob.id, 'comment-btn', commentJob.commentsCount);
      }
    } catch (e) { toast('Could not delete comment.'); }
  }

  function repaintRailCount(jobId, cls, count) {
    var post = scrollEl.querySelector('.feed-post[data-job-id="' + cssEsc(jobId) + '"]');
    if (!post) return;
    var btn = post.querySelector('.' + cls + ' .rail-count');
    if (btn) btn.textContent = count > 0 ? String(count) : '';
  }

  // ---- Search panel ----
  var searchTimer = null;
  var followingIds = null;

  window.Feed.openSearch = function () {
    $('searchOverlay').classList.remove('hidden');
    var input = $('searchInput');
    input.value = '';
    $('searchResults').innerHTML = '<div class="comment-empty">Search for people by name or @handle.</div>';
    setTimeout(function () { input.focus(); }, 50);
    if (isRealUser() && followingIds === null) loadFollowing();
  };
  window.Feed.closeSearch = function () { $('searchOverlay').classList.add('hidden'); };

  async function loadFollowing() {
    try {
      var res = await authFetch(API_BASE + '/friends/following');
      if (!res.ok) return;
      var list = await res.json();
      followingIds = new Set((Array.isArray(list) ? list : []).map(function (u) { return u.id; }));
    } catch (e) { followingIds = new Set(); }
  }

  window.Feed.onSearchInput = function () {
    var q = $('searchInput').value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 2) { $('searchResults').innerHTML = '<div class="comment-empty">Type at least 2 characters.</div>'; return; }
    searchTimer = setTimeout(function () { runSearch(q); }, 400);
  };

  async function runSearch(q) {
    $('searchResults').innerHTML = '<div class="comment-empty">Searching…</div>';
    try {
      var res = await authFetch(API_BASE + '/friends/search?q=' + encodeURIComponent(q));
      if (!res.ok) throw new Error();
      var users = await res.json();
      renderUserRows($('searchResults'), Array.isArray(users) ? users : [], 'No users found.');
    } catch (e) {
      $('searchResults').innerHTML = '<div class="comment-empty">Search failed.</div>';
    }
  }

  function renderUserRows(container, users, emptyMsg) {
    container.innerHTML = '';
    if (!users.length) { container.innerHTML = '<div class="comment-empty">' + escapeHtml(emptyMsg) + '</div>'; return; }
    users.forEach(function (u) {
      var row = document.createElement('div');
      row.className = 'user-row';
      var av = avatarEl(u.avatarUrl, u.username, 'u-avatar');
      av.onclick = function () { openProfile(u.username); };
      row.appendChild(av);
      var main = document.createElement('div');
      main.className = 'u-main';
      main.onclick = function () { openProfile(u.username); };
      main.innerHTML = '<div class="u-name">' + escapeHtml(fullName(u) || u.username) + '</div>' +
        '<div class="u-handle">@' + escapeHtml(u.username) + '</div>' +
        (u.bio ? '<div class="u-bio">' + escapeHtml(u.bio) + '</div>' : '');
      row.appendChild(main);
      if (u.username !== myUsername()) {
        var following = followingIds ? followingIds.has(u.id) : false;
        row.appendChild(followButton(u.id, following));
      }
      container.appendChild(row);
    });
  }

  function followButton(userId, following) {
    var btn = document.createElement('button');
    btn.className = 'follow-btn' + (following ? ' following' : '');
    btn.textContent = following ? 'Following' : 'Follow';
    btn.dataset.following = following ? '1' : '0';
    btn.onclick = function () { toggleFollow(userId, btn); };
    return btn;
  }

  async function toggleFollow(userId, btn) {
    if (!requireReal('Sign up to follow creators.')) return;
    var following = btn.dataset.following === '1';
    var target = !following;
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/friends/' + (target ? 'follow/' : 'unfollow/') + userId, { method: target ? 'POST' : 'DELETE' });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        if (d.error === 'GUEST_SIGNUP_REQUIRED') { requireReal('Sign up to follow creators.'); return; }
        throw new Error();
      }
      btn.dataset.following = target ? '1' : '0';
      btn.textContent = target ? 'Following' : 'Follow';
      btn.classList.toggle('following', target);
      if (followingIds) { if (target) followingIds.add(userId); else followingIds.delete(userId); }
    } catch (e) { toast('Could not update follow.'); }
    finally { btn.disabled = false; }
  }

  // ---- Profile panel ----
  async function openProfile(username) {
    var ov = $('profileOverlay');
    ov.classList.remove('hidden');
    var body = $('profileBody');
    body.innerHTML = '<div class="feed-status"><div class="spinner"></div></div>';
    try {
      var res = await authFetch(API_BASE + '/profile/' + encodeURIComponent(username));
      if (!res.ok) throw new Error();
      var p = await res.json();
      renderProfile(p);
    } catch (e) {
      body.innerHTML = '<div class="comment-empty">Could not load this profile.</div>';
    }
  }
  window.Feed.closeProfile = function () { $('profileOverlay').classList.add('hidden'); };

  function renderProfile(p) {
    var body = $('profileBody');
    body.innerHTML = '';
    var hero = document.createElement('div');
    hero.className = 'profile-hero';
    var av = avatarEl(p.avatarUrl, p.username, 'profile-avatar');
    hero.appendChild(av);
    var nm = document.createElement('h2');
    nm.className = 'profile-name';
    nm.textContent = fullName(p) || ('@' + p.username);
    hero.appendChild(nm);
    var handle = document.createElement('p');
    handle.className = 'profile-handle';
    handle.textContent = '@' + p.username;
    hero.appendChild(handle);
    if (p.bio) { var bio = document.createElement('p'); bio.className = 'profile-bio'; bio.textContent = p.bio; hero.appendChild(bio); }
    body.appendChild(hero);

    var stats = document.createElement('div');
    stats.className = 'profile-stats';
    stats.innerHTML =
      stat(p.creationCount, 'Creations') + stat(p.followersCount, 'Followers') +
      stat(p.followingCount, 'Following') + stat(p.likesCount, 'Likes');
    body.appendChild(stats);

    if (!p.isSelf) {
      var fb = followButton(p.id, !!p.isFollowing);
      fb.style.width = '100%';
      fb.style.marginBottom = '0.9rem';
      body.appendChild(fb);
    }

    var gridTitle = document.createElement('h3');
    gridTitle.style.cssText = 'font-size:.95rem;margin:.5rem 0;color:var(--text-2)';
    gridTitle.textContent = 'Public Creations';
    body.appendChild(gridTitle);

    var jobs = p.jobs || [];
    if (!jobs.length) { var e = document.createElement('div'); e.className = 'comment-empty'; e.textContent = 'No public creations.'; body.appendChild(e); return; }
    var grid = document.createElement('div');
    grid.className = 'profile-grid';
    jobs.forEach(function (j) {
      var item = document.createElement('div');
      item.className = 'grid-item';
      var thumb = document.createElement('img');
      thumb.loading = 'lazy';
      thumb.src = (j.kind === 'VIDEO' ? (j.sourceImageUrl || j.resultImageUrl) : (j.resultImageUrl || j.resultImage2Url)) || '';
      item.appendChild(thumb);
      if (j.kind === 'VIDEO') { var pl = document.createElement('span'); pl.className = 'g-play'; pl.innerHTML = '&#9658;'; item.appendChild(pl); }
      item.onclick = function () { openViewer(j); };
      grid.appendChild(item);
    });
    body.appendChild(grid);
  }
  function stat(n, label) { return '<div class="stat"><b>' + (n || 0) + '</b><span>' + label + '</span></div>'; }

  function openViewer(job) {
    var v = $('mediaViewer');
    var inner = $('viewerInner');
    inner.innerHTML = '';
    if (job.kind === 'VIDEO' && job.videoUrl) {
      var vid = document.createElement('video');
      vid.src = job.videoUrl; vid.controls = true; vid.autoplay = true; vid.playsInline = true;
      if (job.sourceImageUrl) vid.poster = job.sourceImageUrl;
      inner.appendChild(vid);
    } else {
      var img = document.createElement('img');
      img.src = job.resultImageUrl || job.resultImage2Url || job.sourceImageUrl || '';
      inner.appendChild(img);
    }
    v.classList.remove('hidden');
  }
  window.Feed.closeViewer = function () {
    var inner = $('viewerInner');
    inner.innerHTML = ''; // stop any playing video
    $('mediaViewer').classList.add('hidden');
  };

  // ---- ⋯ post menu (own vs others) ----
  function openPostMenu(job, ev) {
    closeMenu();
    var menu = document.createElement('div');
    menu.className = 'action-menu';
    menu.id = 'activeMenu';
    var mine = job.user.username === myUsername();
    var items = [];
    if (mine) {
      items.push(['Share', function () { shareJob(job); }]);
      items.push([job.isPrivate ? 'Make public' : 'Make private', function () { togglePrivacy(job); }]);
      items.push(['Delete', function () { deletePost(job); }, true]);
    } else {
      items.push(['Share', function () { shareJob(job); }]);
      items.push(['Report post', function () { reportContent('CREATION', job.id); }]);
      items.push(['Report user', function () { reportUserByUsername(job.user.username); }]);
      items.push(['Block @' + job.user.username, function () { blockUserByUsername(job.user.username); }, true]);
    }
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.textContent = it[0];
      if (it[2]) b.className = 'danger';
      b.onclick = function () { closeMenu(); it[1](); };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    // Position near the click, kept on-screen.
    var x = Math.min(ev.clientX, window.innerWidth - 220);
    var y = Math.min(ev.clientY, window.innerHeight - (items.length * 44 + 20));
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
    setTimeout(function () { document.addEventListener('click', closeMenu, { once: true }); }, 0);
  }
  function closeMenu() { var m = $('activeMenu'); if (m) m.remove(); }

  async function togglePrivacy(job) {
    var target = !job.isPrivate;
    try {
      var res = await authFetch(API_BASE + '/creations/' + job.id + '/privacy', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPrivate: target }),
      });
      if (!res.ok) throw new Error();
      job.isPrivate = target;
      toast(target ? 'Made private (removed from feed)' : 'Made public');
      if (target) removePostFromDom(job.id);
    } catch (e) { toast('Could not update privacy.'); }
  }

  async function deletePost(job) {
    if (!confirm('Delete this creation permanently? This cannot be undone.')) return;
    try {
      var res = await authFetch(API_BASE + '/creations/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobIds: [job.id] }),
      });
      if (!res.ok) throw new Error();
      removePostFromDom(job.id);
      toast('Deleted');
    } catch (e) { toast('Could not delete.'); }
  }

  function removePostFromDom(jobId) {
    var post = scrollEl.querySelector('.feed-post[data-job-id="' + cssEsc(jobId) + '"]');
    if (post) post.remove();
    delete players[jobId];
  }

  async function reportContent(type, id) {
    if (!requireReal('Sign up to report content.')) return;
    var reason = pickReason();
    if (!reason) return;
    try {
      var res = await authFetch(API_BASE + '/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: type, targetId: id, reason: reason }),
      });
      if (!res.ok) throw new Error();
      toast('Report submitted. Thank you.');
    } catch (e) { toast('Could not submit report.'); }
  }
  function pickReason() {
    var input = window.prompt('Report reason — type one of:\nINAPPROPRIATE, HARASSMENT, IMPERSONATION, SPAM, COPYRIGHT, OTHER', 'INAPPROPRIATE');
    if (!input) return null;
    var up = input.trim().toUpperCase();
    var valid = ['INAPPROPRIATE', 'HARASSMENT', 'IMPERSONATION', 'SPAM', 'COPYRIGHT', 'OTHER'];
    return valid.indexOf(up) >= 0 ? up : 'OTHER';
  }

  async function reportUserByUsername(username) {
    if (!requireReal('Sign up to report users.')) return;
    var id = await resolveUserId(username);
    if (id) reportContent('USER', id);
  }
  async function blockUserByUsername(username) {
    if (!requireReal('Sign up to block users.')) return;
    if (!confirm('Block @' + username + '? Their posts will be hidden from your feed.')) return;
    var id = await resolveUserId(username);
    if (!id) { toast('Could not block user.'); return; }
    try {
      var res = await authFetch(API_BASE + '/users/' + id + '/block', { method: 'POST' });
      if (!res.ok) throw new Error();
      // Remove all of their posts currently in the feed.
      state.posts.filter(function (p) { return p.user.username === username; }).forEach(function (p) { removePostFromDom(p.id); });
      toast('Blocked @' + username);
    } catch (e) { toast('Could not block user.'); }
  }
  async function resolveUserId(username) {
    try {
      var res = await authFetch(API_BASE + '/profile/' + encodeURIComponent(username));
      if (!res.ok) return null;
      var p = await res.json();
      return p.id || null;
    } catch (e) { return null; }
  }

  // ---- Status / empty ----
  function showFeedStatus(msg, isError, spinner) {
    clearFeedStatus();
    var el = document.createElement('div');
    el.className = 'feed-status';
    el.id = 'feedStatus';
    if (spinner) el.innerHTML = '<div class="spinner"></div>';
    else el.innerHTML = '<div>' + escapeHtml(msg) + '</div>' + (isError ? '<button class="banner-ghost" onclick="location.reload()">Retry</button>' : '');
    scrollEl.insertBefore(el, $('feedEndSentinel'));
  }
  function clearFeedStatus() { var s = $('feedStatus'); if (s) s.remove(); }
  function showEmpty() {
    clearFeedStatus();
    var el = document.createElement('div');
    el.className = 'feed-end';
    el.id = 'feedStatus';
    el.innerHTML = '<div class="empty-glow"></div><h2 style="margin:.3rem 0">No creations yet</h2>' +
      '<p class="stage-hint">Be the first — <a href="/create.html" style="color:var(--cyan)">create something</a>.</p>';
    scrollEl.insertBefore(el, $('feedEndSentinel'));
  }

  // ---- Helpers ----
  function fullName(u) { return [u.firstName, u.lastName].filter(Boolean).join(' '); }
  function avatarEl(url, username, cls) {
    if (url) {
      var img = document.createElement('img');
      img.className = cls; img.src = url; img.alt = username || '';
      return img;
    }
    var d = document.createElement('div');
    d.className = cls;
    d.textContent = (username || '?').charAt(0).toUpperCase();
    return d;
  }
  function timeAgo(s) {
    try {
      var diff = (Date.now() - new Date(s).getTime()) / 1000;
      if (diff < 60) return 'now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h';
      if (diff < 604800) return Math.floor(diff / 86400) + 'd';
      return new Date(s).toLocaleDateString();
    } catch (e) { return ''; }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
})();
