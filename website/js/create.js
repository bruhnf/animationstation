// AnimationStation — web "Create" studio.
//
// Full parity with the mobile Create screen: generate AI images and videos from
// the browser. Everything created here is a Creation in the SAME database, shows
// up in "My Creations", and (when public) on the in-app community feed.
//
//   IMAGE mode  → POST /api/transform   (multipart: photos?, prompt, aspectRatio)
//                 text-to-image when no photo is attached; single-image transform
//                 when one is. Response 202 { jobId, ... }.
//   VIDEO mode  → POST /api/video       (multipart: photo | sourceJobId,
//                 motionPrompt, aspectRatio, durationSec). Response 202 { jobId, ... }.
//
// Both are async: we poll GET /api/creations/:jobId every 3s until COMPLETE /
// FAILED. The AI-consent gate (App Store Guidelines 5.1.1(i)/5.1.2(i)) is
// enforced server-side; a 403 AI_CONSENT_REQUIRED opens the consent modal, which
// POSTs /api/profile/me/ai-consent and then retries the exact same submission.
//
// Reuses helpers from auth.js (API_BASE, authFetch, getAccessToken, getUser, logout).
(function () {
  'use strict';

  // ---- Auth guard: bounce to login if there's no session ----
  if (!getAccessToken() || !getUser()) {
    window.location.href = '/login.html';
    return;
  }

  var PROMPT_MAX = 1000; // lockstep with backend TRANSFORM_PROMPT_MAX_LENGTH / MOTION_PROMPT_MAX

  // ---- State ----
  var mode = 'image'; // 'image' | 'video'
  var attachedFile = null; // File chosen from disk (reference/source image)
  var attachedUrl = null; // object URL for its thumbnail
  var pendingSourceJobId = null; // set by "Make Video" — animate a finished image by id
  var pendingSourceUrl = null; // that image's presigned URL (for the thumbnail)
  var activeJob = null; // the job currently generating / just finished
  var pollTimer = null;
  var lastSubmit = null; // captured inputs so "Regenerate" can re-run verbatim
  var submitting = false;
  var videoCreditCost = 2; // overwritten by GET /api/config

  // ---- Element handles ----
  var $ = function (id) { return document.getElementById(id); };
  var promptInput = $('promptInput');
  var fileInput = $('fileInput');
  var stage = $('stage');
  var resultActions = $('resultActions');

  document.addEventListener('DOMContentLoaded', function () {
    renderStage();
    updateModeUI();
    loadConfig();
    loadCredits();

    promptInput.addEventListener('input', function () {
      $('charCount').textContent = String(promptInput.value.length);
      autoGrow();
    });
    fileInput.addEventListener('change', onFileChosen);
  });

  function autoGrow() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(160, promptInput.scrollHeight) + 'px';
  }

  // ---- Config + credits ----
  async function loadConfig() {
    try {
      var res = await fetch(API_BASE + '/config');
      if (!res.ok) return;
      var data = await res.json();
      if (typeof data.videoCreditCost === 'number') videoCreditCost = data.videoCreditCost;
      updateCostHint();
    } catch (e) { /* non-fatal — keep the default */ }
  }

  async function loadCredits() {
    try {
      var res = await authFetch(API_BASE + '/profile/me');
      if (!res.ok) return;
      var user = await res.json();
      if (typeof user.credits === 'number') $('creditsValue').textContent = String(user.credits);
      setUser(user); // keep the cached user fresh (consent state, etc.)
    } catch (e) { /* non-fatal */ }
  }

  // ---- Mode ----
  window.setMode = function (next) {
    if (next === mode || busy()) return;
    mode = next;
    // Switching to image drops any pending "make video" source.
    if (mode === 'image') clearPendingSource();
    updateModeUI();
  };

  function updateModeUI() {
    $('modeImage').classList.toggle('active', mode === 'image');
    $('modeVideo').classList.toggle('active', mode === 'video');
    $('durationSeg').classList.toggle('hidden', mode !== 'video');
    promptInput.placeholder = mode === 'video' ? 'Describe the motion…' : 'Type to imagine…';
    // Video animates exactly one image; if two were somehow attached, trim.
    updateCostHint();
    renderThumbs();
  }

  function updateCostHint() {
    var hint = $('costHint');
    if (mode === 'video') {
      hint.textContent = 'Video · ' + videoCreditCost + ' credit' + (videoCreditCost === 1 ? '' : 's');
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }

  // ---- Attachments ----
  window.pickImage = function () {
    if (busy()) return;
    fileInput.click();
  };

  function onFileChosen() {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showError('Image is too large. Maximum size is 10 MB.');
      return;
    }
    // A disk upload replaces any pending "make video" source.
    clearPendingSource();
    if (attachedUrl) URL.revokeObjectURL(attachedUrl);
    attachedFile = file;
    attachedUrl = URL.createObjectURL(file);
    renderThumbs();
  }

  window.removeAttachment = function () {
    if (attachedUrl) URL.revokeObjectURL(attachedUrl);
    attachedFile = null;
    attachedUrl = null;
    clearPendingSource();
    renderThumbs();
  };

  function clearPendingSource() {
    pendingSourceJobId = null;
    pendingSourceUrl = null;
  }

  function renderThumbs() {
    var row = $('thumbRow');
    row.innerHTML = '';
    var url = attachedUrl || pendingSourceUrl;
    if (!url) { row.classList.add('hidden'); return; }
    row.classList.remove('hidden');
    var wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Attached image';
    var rm = document.createElement('button');
    rm.className = 'thumb-remove';
    rm.innerHTML = '&times;';
    rm.title = 'Remove';
    rm.onclick = window.removeAttachment;
    wrap.appendChild(img);
    wrap.appendChild(rm);
    row.appendChild(wrap);
  }

  // ---- Submit ----
  function busy() {
    return submitting || (activeJob !== null && activeJob.status !== 'COMPLETE' && activeJob.status !== 'FAILED');
  }

  window.submitCreation = function () {
    if (busy()) return;
    var prompt = promptInput.value.trim();
    var hasSource = !!attachedFile || !!pendingSourceJobId;

    if (mode === 'video') {
      if (!hasSource) { showError('Attach a photo to animate (or use “Make Video” on a finished image).'); return; }
      if (!prompt) { showError('Describe the motion you want in the video.'); return; }
    } else {
      if (!prompt && !attachedFile) { showError('Describe what you want to create, or attach a photo to transform.'); return; }
    }

    performSubmit({
      mode: mode,
      prompt: prompt,
      file: attachedFile,
      sourceJobId: pendingSourceJobId,
      aspect: $('aspectSelect').value,
      durationSec: parseInt($('durationSelect').value, 10) || 8,
    });
  };

  window.handleRegenerate = function () {
    if (busy() || !lastSubmit) return;
    performSubmit(lastSubmit);
  };

  async function performSubmit(input) {
    lastSubmit = input;
    submitting = true;
    clearMessages();
    activeJob = null;
    renderStage();
    updateSubmitState();

    try {
      var form = new FormData();
      form.append('aspectRatio', input.aspect);
      if (input.mode === 'video') {
        form.append('motionPrompt', input.prompt);
        form.append('durationSec', String(input.durationSec));
        if (input.file) form.append('photo', input.file);
        else if (input.sourceJobId) form.append('sourceJobId', input.sourceJobId);
      } else {
        form.append('prompt', input.prompt);
        if (input.file) form.append('photos', input.file);
      }

      var endpoint = input.mode === 'video' ? '/video' : '/transform';
      var res = await authFetch(API_BASE + endpoint, { method: 'POST', body: form });
      var data = await res.json().catch(function () { return {}; });

      if (!res.ok) { handleSubmitError(data, input); return; }

      activeJob = {
        id: data.jobId,
        status: 'PENDING',
        kind: input.mode === 'video' ? 'VIDEO' : 'IMAGE',
        scheduledStartAt: data.scheduledStartAt || null,
      };
      renderStage();
      loadCredits(); // reflect the credit spend immediately

      if (data.queueDelayMs && data.queueDelayMs > 0) {
        var secs = Math.max(1, Math.round(data.queueDelayMs / 1000));
        showSuccess('A lot of members are creating right now — yours starts in about ' + secs + ' second' + (secs === 1 ? '' : 's') + '.');
      }
      startPolling(data.jobId);
    } catch (err) {
      showError('Could not start your creation. Please try again.');
    } finally {
      submitting = false;
      updateSubmitState();
    }
  }

  function handleSubmitError(data, input) {
    var code = data && data.error;
    switch (code) {
      case 'AI_CONSENT_REQUIRED':
        openConsent(input);
        return;
      case 'SUBSCRIPTION_REQUIRED':
      case 'WEEKLY_LIMIT_REACHED':
        showError((data.message || 'You need credits or a subscription to create.') + ' Purchase credits in the app to continue.');
        return;
      case 'CREATION_LIMIT_REACHED':
        showError(data.message || 'Storage full — delete some creations to continue.');
        return;
      case 'PROMPT_REJECTED':
      case 'INVALID_MOTION_PROMPT':
      case 'PROMPT_REQUIRED':
        showError(data.message || 'Please adjust your prompt and try again.');
        return;
      case 'INPUT_MODERATION_BLOCKED':
        showError(data.message || "This image can't be used. Please choose a different one.");
        return;
      case 'NO_SOURCE':
        showError(data.message || 'Pick a photo to animate.');
        return;
      default:
        showError((data && (data.message || data.error)) || 'Something went wrong. Please try again.');
    }
  }

  // ---- Polling ----
  function startPolling(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      try {
        var res = await authFetch(API_BASE + '/creations/' + jobId);
        if (!res.ok) return; // transient — keep polling
        var job = await res.json();
        activeJob = job;
        if (job.status === 'COMPLETE' || job.status === 'FAILED') {
          clearInterval(pollTimer);
          pollTimer = null;
          if (job.status === 'COMPLETE') {
            // Clear the composer for the next idea; the result stays on the
            // stage and is already in My Creations + (if public) the feed.
            promptInput.value = '';
            $('charCount').textContent = '0';
            autoGrow();
            window.removeAttachment();
            loadCredits();
          } else {
            showError(job.errorMessage || 'Generation failed. Any credit spent was refunded.');
          }
          renderStage();
        } else {
          renderStage();
        }
        updateSubmitState();
      } catch (e) { /* transient poll failure — job continues server-side */ }
    }, 3000);
  }

  // ---- Stage rendering ----
  function isVideoJob(job) { return job && (job.kind === 'VIDEO' || !!job.videoUrl); }
  function resultUrl(job) {
    if (isVideoJob(job)) return job.videoUrl || null;
    return job.resultImageUrl || job.resultImage2Url || null;
  }
  function posterUrl(job) {
    if (isVideoJob(job)) return job.sourceImageUrl || job.resultImageUrl || null;
    return job.resultImageUrl || job.resultImage2Url || null;
  }

  function renderStage() {
    resultActions.classList.add('hidden');
    resultActions.innerHTML = '';

    if (activeJob && activeJob.status === 'COMPLETE') {
      var url = resultUrl(activeJob);
      var poster = posterUrl(activeJob);
      if (url || poster) {
        stage.innerHTML = '';
        var media;
        if (isVideoJob(activeJob) && url) {
          media = document.createElement('video');
          media.src = url;
          if (poster) media.poster = poster;
          media.controls = true;
          media.playsInline = true;
          media.preload = 'metadata';
          media.className = 'result-media';
        } else {
          media = document.createElement('img');
          media.src = poster;
          media.alt = activeJob.title || 'AI creation';
          media.className = 'result-media';
        }
        stage.appendChild(media);
        var badge = document.createElement('span');
        badge.className = 'result-ai-badge';
        badge.textContent = '✨ AI-generated';
        stage.appendChild(badge);
        renderResultActions();
        return;
      }
    }

    if (busy()) {
      var starts = queueCountdown();
      stage.innerHTML =
        '<div class="stage-busy">' +
        '<div class="spinner"></div>' +
        '<p class="stage-status">' + (starts || (mode === 'video' ? 'Animating… videos can take a few minutes' : 'Creating…')) + '</p>' +
        '<p class="stage-hint">You can stay here — results also land in My Creations.</p>' +
        '</div>';
      return;
    }

    // Idle
    stage.innerHTML =
      '<div class="stage-idle">' +
      '<p class="brandline">Imagine. Create. Transcend.</p>' +
      '<p class="stage-hint">Describe anything — or attach a photo to transform or animate it.</p>' +
      '</div>';
  }

  function queueCountdown() {
    if (!activeJob || !activeJob.scheduledStartAt) return null;
    var left = Math.round((new Date(activeJob.scheduledStartAt).getTime() - Date.now()) / 1000);
    if (left <= 0) return null;
    var m = Math.floor(left / 60), s = left % 60;
    return 'In the queue — starts in ' + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderResultActions() {
    resultActions.classList.remove('hidden');
    resultActions.innerHTML = '';
    var video = isVideoJob(activeJob);

    resultActions.appendChild(actionBtn('⭳ Download', downloadResult));
    if (!video) resultActions.appendChild(actionBtn('🎬 Make Video', makeVideo));
    resultActions.appendChild(actionBtn('↻ Regenerate', window.handleRegenerate));
    resultActions.appendChild(actionBtn('✕ Clear', clearResult));
  }

  function actionBtn(label, onClick) {
    var b = document.createElement('button');
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  // ---- Result actions ----
  async function downloadResult() {
    if (!activeJob) return;
    var url = resultUrl(activeJob);
    if (!url) { showError('This creation has no downloadable result.'); return; }
    var ext = isVideoJob(activeJob) ? 'mp4' : 'jpg';
    try {
      var res = await fetch(url); // presigned S3 URL — public read, CORS-enabled
      if (!res.ok) throw new Error();
      var blob = await res.blob();
      var objUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objUrl;
      a.download = 'animationstation-' + activeJob.id + '.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      showError('Download failed. Please try again.');
    }
  }

  // Hand a finished IMAGE off to the video generator: switch to Video mode and
  // animate it by id (no re-upload — the backend reads sourceJobId).
  function makeVideo() {
    if (!activeJob || isVideoJob(activeJob)) return;
    var img = activeJob.resultImageUrl || activeJob.resultImage2Url;
    if (!img) return;
    pendingSourceJobId = activeJob.id;
    pendingSourceUrl = img;
    if (attachedUrl) { URL.revokeObjectURL(attachedUrl); attachedUrl = null; }
    attachedFile = null;
    mode = 'video';
    activeJob = null;
    updateModeUI();
    renderStage();
    promptInput.focus();
    showSuccess('Now describe the motion for your video, then press ↑.');
  }

  function clearResult() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    activeJob = null;
    clearMessages();
    renderStage();
    updateSubmitState();
  }

  function updateSubmitState() {
    $('submitBtn').disabled = busy();
    $('attachBtn').disabled = busy();
  }

  // ---- AI consent flow ----
  var consentResubmit = null;
  function openConsent(input) {
    consentResubmit = input;
    $('consentBody').innerHTML = input.mode === 'video'
      ? 'To generate your video, your photo and motion prompt will be sent to <strong>xAI (Grok Imagine API)</strong> for AI processing. Your inputs are used only to produce your result. Do you agree to proceed?'
      : 'To generate your image, your text prompt and any photo you attach will be sent to <strong>xAI (Grok Imagine API)</strong> for AI processing. Your inputs are used only to produce your result. Do you agree to proceed?';
    $('consentModal').classList.remove('hidden');
  }

  window.cancelConsent = function () {
    consentResubmit = null;
    $('consentModal').classList.add('hidden');
  };

  window.agreeConsent = async function () {
    var btn = $('consentAgreeBtn');
    btn.disabled = true;
    try {
      var res = await authFetch(API_BASE + '/profile/me/ai-consent', { method: 'POST' });
      if (!res.ok) throw new Error();
      $('consentModal').classList.add('hidden');
      var input = consentResubmit;
      consentResubmit = null;
      if (input) performSubmit(input);
    } catch (e) {
      showError('Could not record your consent. Please try again.');
    } finally {
      btn.disabled = false;
    }
  };

  // ---- Message helpers ----
  function clearMessages() {
    $('errorMsg').classList.remove('visible');
    $('successMsg').classList.remove('visible');
  }
  function showError(msg) {
    var el = $('errorMsg');
    el.textContent = msg;
    el.classList.add('visible');
    window.scrollTo(0, 0);
  }
  function showSuccess(msg) {
    var el = $('successMsg');
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(function () { el.classList.remove('visible'); }, 5000);
  }
})();
