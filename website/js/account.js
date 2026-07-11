// AnimationStation — Account-management page logic.
// Reuses helpers from auth.js (API_BASE, authFetch [auto-refreshes on 401],
// getProfile, isRealUser, getUser, setUser, clearTokens, logout).
(function () {
  'use strict';

  // ---- Auth guard: bounce to login unless a real account is signed in ----
  // (a feed guest carries a token, but has no account to manage)
  if (!isRealUser()) {
    window.location.href = '/login.html';
    return;
  }

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const user = await getProfile(); // GET /profile/me (also caches via setUser)
      populate(user);
    } catch (e) {
      showError('Could not load your account. Please refresh, or log in again.');
    }
  }

  var LOW_CREDITS_THRESHOLD = 3;

  function populate(u) {
    setText('ovUsername', u.username || '—');
    setText('ovEmail', u.email || '—');
    setText('ovTier', tierLabel(u.tier));
    setText('ovVerified', u.verified ? 'Yes' : 'No');
    setText('subTier', tierLabel(u.tier));

    const credits = u.credits != null ? u.credits : 0;
    setText('cbCredits', String(credits));
    setText('cbTier', tierLabel(u.tier));
    document.getElementById('creditsBanner')?.classList.toggle('low', credits <= LOW_CREDITS_THRESHOLD);
    // Only a paid tier COULD have a Stripe subscription to manage — avoid
    // showing the button to FREE users where /api/billing/portal would 404
    // (no Stripe customer on file yet).
    if (u.tier === 'BASIC' || u.tier === 'PREMIUM') show('portalBtn');
    setVal('firstName', u.firstName || '');
    setVal('lastName', u.lastName || '');
    setVal('bio', u.bio || '');
    paintAvatar(u);

    const granted = !!u.aiProcessingConsentAt;
    const el = document.getElementById('consentStatus');
    if (granted) {
      el.innerHTML = '<span class="pill pill-ok">Granted</span> ' + escapeHtml(fmtDate(u.aiProcessingConsentAt));
      show('revokeConsentBtn');
    } else {
      el.innerHTML = '<span class="pill pill-no">Not granted</span>';
      hide('revokeConsentBtn');
    }
  }

  // ---- Profile photo (POST/DELETE /api/upload/avatar) ----
  // Same endpoint the mobile app's avatar picker uses — server-side resize to a
  // square crop happens in uploadController regardless of which client posted it.
  function paintAvatar(u) {
    const el = document.getElementById('avatarPreview');
    if (!el) return;
    if (u.avatarUrl) {
      el.style.backgroundImage = `url("${u.avatarUrl}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
      show('avatarRemoveBtn');
    } else {
      el.style.backgroundImage = '';
      el.textContent = (u.firstName || u.username || '?').charAt(0).toUpperCase();
      hide('avatarRemoveBtn');
    }
  }

  window.uploadAvatar = async function (e) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const btn = document.getElementById('avatarUploadBtn');
    busy(btn, 'Uploading…');
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await authFetch(`${API_BASE}/upload/avatar`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Could not upload photo');
      const user = Object.assign({}, getUser(), { avatarUrl: data.url });
      setUser(user);
      paintAvatar(user);
      showSuccess('Profile photo updated.');
    } catch (err) {
      showError(err.message);
    } finally {
      unbusy(btn, 'Change photo');
      input.value = ''; // allow re-selecting the same file
    }
  };

  window.removeAvatar = async function () {
    if (!confirm('Remove your profile photo?')) return;
    const btn = document.getElementById('avatarRemoveBtn');
    busy(btn, 'Removing…');
    try {
      const res = await authFetch(`${API_BASE}/upload/avatar`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove photo');
      const user = Object.assign({}, getUser(), { avatarUrl: null });
      setUser(user);
      paintAvatar(user);
      showSuccess('Profile photo removed.');
    } catch (err) {
      showError(err.message);
    } finally {
      unbusy(btn, 'Remove photo');
    }
  };

  // ---- Save profile (PATCH /profile/me) ----
  window.saveProfile = async function (e) {
    e.preventDefault();
    const btn = document.getElementById('saveProfileBtn');
    busy(btn, 'Saving…');
    try {
      const body = { firstName: getVal('firstName'), lastName: getVal('lastName'), bio: getVal('bio') };
      const res = await authFetch(`${API_BASE}/profile/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Could not save profile');
      if (data && data.username) { setUser(data); populate(data); }
      showSuccess('Profile saved.');
    } catch (err) { showError(err.message); }
    finally { unbusy(btn, 'Save profile'); }
  };

  // ---- Change password (POST /auth/change-password) ----
  // Server revokes ALL refresh tokens on success, so we drop the session and
  // send the user back to login (mirrors the mobile app behaviour).
  window.changePasswordSubmit = async function (e) {
    e.preventDefault();
    const cur = getVal('curPw'), nw = getVal('newPw'), conf = getVal('confPw');
    if (nw !== conf) { showError('New passwords do not match.'); return; }
    const btn = document.getElementById('changePwBtn');
    busy(btn, 'Updating…');
    try {
      const res = await authFetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Could not change password');
      showSuccess('Password updated. Please log in again.');
      clearTokens();
      setTimeout(() => (window.location.href = '/login.html'), 1500);
    } catch (err) { showError(err.message); unbusy(btn, 'Update password'); }
  };

  // ---- Manage billing (GET /api/billing/portal → Stripe Billing Portal) ----
  window.openBillingPortal = async function () {
    try {
      const res = await authFetch(`${API_BASE}/billing/portal`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (err) { showError(err.message); }
  };

  // ---- Revoke AI consent (DELETE /profile/me/ai-consent) ----
  window.revokeConsent = async function () {
    if (!confirm('Revoke AI processing consent? You will be asked again next time you create with AI.')) return;
    try {
      const res = await authFetch(`${API_BASE}/profile/me/ai-consent`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not revoke consent');
      document.getElementById('consentStatus').innerHTML = '<span class="pill pill-no">Not granted</span>';
      hide('revokeConsentBtn');
      showSuccess('AI processing consent revoked.');
    } catch (err) { showError(err.message); }
  };

  // ---- Export data (GET /profile/me/export → download) ----
  window.exportData = async function () {
    const btn = document.getElementById('exportBtn');
    busy(btn, 'Preparing…');
    try {
      const res = await authFetch(`${API_BASE}/profile/me/export`);
      if (!res.ok) throw new Error('Could not export data');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'animationstation-my-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showSuccess('Your data download has started.');
    } catch (err) { showError(err.message); }
    finally { unbusy(btn, 'Export my data'); }
  };

  // ---- Blocked users (GET /users/me/blocks, DELETE /users/:id/block) ----
  let blockedShown = false;
  window.toggleBlocked = async function () {
    blockedShown = !blockedShown;
    document.getElementById('blockedWrap').classList.toggle('hidden', !blockedShown);
    if (blockedShown) await loadBlocked();
  };

  async function loadBlocked() {
    const list = document.getElementById('blockedList');
    const empty = document.getElementById('blockedEmpty');
    list.innerHTML = '';
    empty.classList.add('hidden');
    try {
      const res = await authFetch(`${API_BASE}/users/me/blocks`);
      if (!res.ok) throw new Error('Could not load blocked users');
      const data = await res.json().catch(() => []);
      const blocks = Array.isArray(data) ? data : (data.blocks || data.users || []);
      if (!blocks.length) { empty.classList.remove('hidden'); return; }
      blocks.forEach((b) => {
        const id = b.id || b.blockedId || b.userId;
        const name = b.username || (b.user && b.user.username) || id;
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = name;
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost';
        btn.textContent = 'Unblock';
        btn.onclick = () => unblock(id, li);
        li.appendChild(span);
        li.appendChild(btn);
        list.appendChild(li);
      });
    } catch (err) { showError(err.message); }
  }

  async function unblock(userId, li) {
    try {
      const res = await authFetch(`${API_BASE}/users/${userId}/block`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not unblock');
      li.remove();
      if (!document.getElementById('blockedList').children.length) {
        document.getElementById('blockedEmpty').classList.remove('hidden');
      }
    } catch (err) { showError(err.message); }
  }

  // ---- Delete account (DELETE /profile/me) ----
  window.deleteAccountConfirm = async function () {
    if (!confirm('Permanently delete your account and ALL data? This cannot be undone.')) return;
    if (prompt('Type DELETE to confirm.') !== 'DELETE') { showError('Account deletion cancelled.'); return; }
    const btn = document.getElementById('deleteBtn');
    busy(btn, 'Deleting…');
    try {
      const res = await authFetch(`${API_BASE}/profile/me`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete account');
      clearTokens();
      alert('Your account has been deleted.');
      window.location.href = '/';
    } catch (err) { showError(err.message); unbusy(btn, 'Delete my account'); }
  };

  // ---- small helpers ----
  function tierLabel(t) { return ({ FREE: 'Free', BASIC: 'Basic', PREMIUM: 'Premium' })[t] || (t || 'Free'); }
  function fmtDate(s) { try { return new Date(s).toLocaleDateString(); } catch (e) { return ''; } }
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
  function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function show(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hide(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  function busy(btn, t) { if (btn) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = t; } }
  function unbusy(btn, t) { if (btn) { btn.disabled = false; btn.textContent = t || btn.dataset.label || ''; } }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function showError(msg) { const el = document.getElementById('errorMsg'); el.innerHTML = msg; el.classList.add('visible'); window.scrollTo(0, 0); }
  function showSuccess(msg) { const el = document.getElementById('successMsg'); el.innerHTML = msg; el.classList.add('visible'); window.scrollTo(0, 0); setTimeout(function () { el.classList.remove('visible'); }, 4000); }
})();
