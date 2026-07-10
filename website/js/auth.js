// AnimationStation Web Authentication
//
// The site and API are served from the same host
// (animationstation.ai), so the API is always same-origin.
const API_BASE = '/api';

// Store tokens in localStorage
function setTokens(accessToken, refreshToken) {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}

function getAccessToken() {
  return localStorage.getItem('accessToken');
}

function getRefreshToken() {
  return localStorage.getItem('refreshToken');
}

function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

function getUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

// The feed mints an anonymous guest session on first visit (POST /auth/guest),
// which puts a token + user into the same localStorage keys a real login uses.
// So "is there a token?" is NOT the same question as "is this a signed-in user?"
// — every auth gate on the site must ask isRealUser(), or a browsing guest looks
// logged in and gets bounced away from the login/signup pages.
function isGuestSession() {
  const user = getUser();
  return !!(user && user.isGuest && getAccessToken());
}

function isRealUser() {
  const user = getUser();
  return !!(user && !user.isGuest && getAccessToken());
}

// Turn an error response body into something a human can read. The API returns
// either { error: '<message or CODE>' }, { error: <zod flatten object> } for a
// 400, or { error: 'CODE', message: '<human text>' }.
function errorMessage(data, fallback) {
  if (!data) return fallback;
  const err = data.error;
  if (err && typeof err === 'object') {
    const parts = [];
    const fieldErrors = err.fieldErrors || {};
    Object.keys(fieldErrors).forEach((field) => {
      (fieldErrors[field] || []).forEach((msg) => parts.push(`${field}: ${msg}`));
    });
    (err.formErrors || []).forEach((msg) => parts.push(msg));
    if (parts.length) return parts.join('. ');
  }
  return data.message || (typeof err === 'string' ? err : null) || fallback;
}

// Build an Error carrying the machine-readable API code, so callers can branch
// on it (e.g. EMAIL_NOT_VERIFIED) instead of string-matching the display text.
function apiError(data, fallback) {
  const error = new Error(errorMessage(data, fallback));
  if (data && typeof data.error === 'string') error.code = data.error;
  return error;
}

// Check if a real (non-guest) user is signed in, and update UI to match.
function checkAuthState() {
  const user = getUser();

  const navAuth = document.getElementById('navAuth');
  const navUser = document.getElementById('navUser');
  const userName = document.getElementById('userName');

  if (isRealUser()) {
    if (navAuth) navAuth.style.display = 'none';
    if (navUser) {
      navUser.style.display = 'flex';
      if (userName) {
        userName.textContent = user.firstName || user.username;
      }
    }
    return true;
  } else {
    if (navAuth) navAuth.style.display = 'flex';
    if (navUser) navUser.style.display = 'none';
    return false;
  }
}

// Logout
function logout() {
  const refreshToken = getRefreshToken();
  
  // Call logout endpoint to invalidate refresh token
  if (refreshToken) {
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  
  clearTokens();
  window.location.href = '/';
}

// Login
async function login(email, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  
  const data = await response.json();

  if (!response.ok) {
    throw apiError(data, 'Login failed');
  }

  setTokens(data.accessToken, data.refreshToken);
  setUser(data.user);

  return data;
}

// Signup — email + password only; the backend generates a user####### handle
// the user can change later in the app's Edit Profile.
//
// A visitor who browsed the feed already owns an anonymous guest row. Upgrading
// that row in place (POST /auth/claim, authenticated as the guest) keeps their
// id, handle, and any pending referral, rather than orphaning the guest and
// creating a second account. A first-time visitor takes the plain signup path.
async function signup(email, password) {
  if (isGuestSession()) {
    const response = await fetch(`${API_BASE}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAccessToken()}`,
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok) {
      // Claim deletes the guest's refresh tokens server-side, so the session we
      // hold is dead. Drop it: the visitor is now an unverified real account and
      // must verify their email, then log in.
      clearTokens();
      return data;
    }

    // The stored guest session was stale (expired, already claimed, or the row
    // was pruned). Fall through to a plain signup rather than dead-ending.
    if (response.status === 401 || data.error === 'ALREADY_REAL_USER') {
      clearTokens();
    } else {
      throw apiError(data, 'Signup failed');
    }
  }

  return signupNewAccount(email, password);
}

async function signupNewAccount(email, password) {
  const response = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw apiError(data, 'Signup failed');
  }

  return data;
}

// Refresh access token
async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  
  if (!refreshToken) {
    throw new Error('No refresh token');
  }
  
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    clearTokens();
    throw new Error('Session expired');
  }
  
  setTokens(data.accessToken, data.refreshToken);
  
  return data.accessToken;
}

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
  let accessToken = getAccessToken();
  
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
  
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${accessToken}`,
  };
  
  let response = await fetch(url, { ...options, headers });
  
  // If token expired, try refreshing
  if (response.status === 401) {
    try {
      accessToken = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${accessToken}`;
      response = await fetch(url, { ...options, headers });
    } catch (e) {
      clearTokens();
      window.location.href = '/login.html';
      throw new Error('Session expired');
    }
  }
  
  return response;
}

// Get user profile
async function getProfile() {
  const response = await authFetch(`${API_BASE}/profile/me`);
  
  if (!response.ok) {
    throw new Error('Failed to get profile');
  }
  
  const user = await response.json();
  setUser(user);
  
  return user;
}

// Resend verification email
async function resendVerification(email) {
  const response = await fetch(`${API_BASE}/auth/resend-verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  
  const data = await response.json();

  if (!response.ok) {
    throw apiError(data, 'Failed to resend verification');
  }

  return data;
}
