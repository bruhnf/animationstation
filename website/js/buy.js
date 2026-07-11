// AnimationStation — Buy Credits & Subscriptions page logic.
// Reuses helpers from auth.js (API_BASE, authFetch, isRealUser).
(function () {
  'use strict';

  if (!isRealUser()) {
    window.location.href = '/login.html';
    return;
  }

  // Mirrors backend/src/services/tierService.ts TIER_CONFIG.creditPrice —
  // used only to render an estimate; the server computes the authoritative
  // price at checkout time from the same table.
  const CREDIT_PRICE = { FREE: 0.6, BASIC: 0.5, PREMIUM: 0.25 };
  const PACK_SIZES = [10, 25, 50, 100];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      showSuccess("Payment received — your account will update within a few seconds. Refresh if it hasn't yet.");
    } else if (params.get('checkout') === 'cancelled') {
      showError('Checkout was cancelled — nothing was charged.');
    }

    try {
      const res = await authFetch(`${API_BASE}/credits/balance`);
      if (!res.ok) throw new Error('Could not load your plan');
      const data = await res.json();
      populate(data);
    } catch (e) {
      showError('Could not load your current plan. Prices below use standard (Free-tier) pricing.');
      populate({ tier: 'FREE', credits: null });
    }
  }

  function populate(data) {
    const tier = data.tier || 'FREE';
    setText('curTier', tierLabel(tier));
    setText('curCredits', data.credits != null ? String(data.credits) : '—');

    const perCredit = CREDIT_PRICE[tier] != null ? CREDIT_PRICE[tier] : CREDIT_PRICE.FREE;
    PACK_SIZES.forEach((n) => setText(`price${n}`, `$${(n * perCredit).toFixed(2)}`));

    document.getElementById('planCardBasic')?.classList.toggle('current', tier === 'BASIC');
    document.getElementById('planCardPremium')?.classList.toggle('current', tier === 'PREMIUM');

    // A Stripe customer only exists once the user has made (or attempted) a
    // web purchase — /api/billing/portal 404s otherwise, so only show the
    // button once we know a subscription purchase has gone through.
    if (tier === 'BASIC' || tier === 'PREMIUM') show('portalBtn');
  }

  window.checkout = async function (product) {
    try {
      const res = await authFetch(`${API_BASE}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (err) {
      showError(err.message);
    }
  };

  window.openPortal = async function () {
    try {
      const res = await authFetch(`${API_BASE}/billing/portal`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (err) {
      showError(err.message);
    }
  };

  function tierLabel(t) { return ({ FREE: 'Free', BASIC: 'Basic', PREMIUM: 'Premium' })[t] || (t || 'Free'); }
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function show(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function showError(msg) { const el = document.getElementById('errorMsg'); el.textContent = msg; el.classList.add('visible'); window.scrollTo(0, 0); }
  function showSuccess(msg) { const el = document.getElementById('successMsg'); el.textContent = msg; el.classList.add('visible'); window.scrollTo(0, 0); }
})();
