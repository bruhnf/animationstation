// TryOn Mirror Web Authentication
//
// API base is derived from where the page is served so the same files work on
// every environment:
//  - api-dev.* (either domain)    → same-origin dev API ('/api')
//  - dev./www-dev.*               → cross-origin dev API (future dev website subdomain)
//  - anything else                → production API
//    (legacy evofaceflow.com hostnames kept until that domain is retired)
const API_BASE = (function () {
  const h = window.location.hostname;
  if (h === 'api-dev.tryon-mirror.ai' || h === 'api-dev.evofaceflow.com') return '/api';
  if (
    h === 'dev.tryon-mirror.ai' || h === 'www-dev.tryon-mirror.ai' ||
    h === 'dev.evofaceflow.com' || h === 'www-dev.evofaceflow.com'
  ) {
    return 'https://api-dev.tryon-mirror.ai/api';
  }
  return 'https://api.tryon-mirror.ai/api';
})();

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

// Check if user is logged in and update UI
function checkAuthState() {
  const user = getUser();
  const accessToken = getAccessToken();
  
  const navAuth = document.getElementById('navAuth');
  const navUser = document.getElementById('navUser');
  const userName = document.getElementById('userName');
  
  if (user && accessToken) {
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
    throw new Error(data.error || data.message || 'Login failed');
  }
  
  setTokens(data.accessToken, data.refreshToken);
  setUser(data.user);
  
  return data;
}

// Signup — email + password only; the backend generates a user####### handle
// the user can change later in the app's Edit Profile.
async function signup(email, password) {
  const response = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Signup failed');
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
    throw new Error(data.error || data.message || 'Failed to resend verification');
  }
  
  return data;
}
