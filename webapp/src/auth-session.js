const API_BASE = import.meta.env.VITE_API_BASE || '';

let token = readStorage('oc_token');
let authRevision = 0;

function storage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStorage(key) {
  try {
    return storage()?.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key, value) {
  try {
    const target = storage();
    if (!target) return;
    if (value) target.setItem(key, value);
    else target.removeItem(key);
  } catch {
    // Private browsing and embedded webviews may deny storage access.
  }
}

function decodeTokenPayload(candidate) {
  try {
    const encodedPayload = String(candidate || '').split('.')[1];
    if (!encodedPayload) return null;
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(globalThis.atob(padded));
  } catch {
    return null;
  }
}

function statusMessage(status) {
  if (status === 400) return '请求内容有误，请检查后重试';
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '当前账号没有执行此操作的权限';
  if (status === 404) return '请求的功能暂时不可用';
  if (status === 429) return '操作过于频繁，请稍后重试';
  if (status >= 500) return '后端服务暂时异常，请稍后重试';
  return '请求失败，请稍后重试';
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    const error = new Error('网络连接失败，请检查后端服务是否运行');
    error.code = 'NETWORK_ERROR';
    error.cause = cause;
    throw error;
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Keep the generic status message when the server returns an empty body.
  }
  if (!response.ok) {
    const error = new Error(data.error || statusMessage(response.status));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function setToken(nextToken) {
  token = String(nextToken || '').trim();
  authRevision += 1;
  writeStorage('oc_token', token);
  globalThis.window?.dispatchEvent?.(new CustomEvent('cc:auth-changed', {
    detail: { loggedIn: Boolean(token), revision: authRevision },
  }));
}

export function getToken() {
  return token;
}

export function getAuthRevision() {
  return authRevision;
}

export function getPushPromptOwner() {
  const userId = decodeTokenPayload(token)?.userId;
  return userId === undefined || userId === null ? '' : `user:${userId}`;
}

export function isTokenExpired(candidate = token) {
  const expiresAt = Number(decodeTokenPayload(candidate)?.exp);
  return Number.isFinite(expiresAt) && Date.now() >= expiresAt * 1000;
}

export const authApi = {
  sendVerificationCode: (email) => request('POST', '/api/auth/send-code', { email }),
  sendPasswordResetCode: (email) => request('POST', '/api/auth/reset-password/send-code', { email }),
  resetPassword: (data) => request('POST', '/api/auth/reset-password', data),
  register: (data) => request('POST', '/api/auth/register', data),
  login: (data) => request('POST', '/api/auth/login', data),
};

export function writeStoredUserProfile(raw) {
  if (!raw || raw.uid === undefined && raw.id === undefined) return null;
  const profile = {
    uid: raw.uid ?? raw.id,
    username: raw.username || '',
    email: raw.email || '',
    display_name: raw.display_name || raw.username || '',
    avatar_url: raw.avatar_url || '',
    account_type: raw.account_type || 'human',
  };
  writeStorage('oc_user', JSON.stringify(profile));
  return profile;
}
