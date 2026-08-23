import React, { lazy, Suspense, useEffect, useState } from 'react';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import { authApi, setToken, writeStoredUserProfile } from '../auth-session';

// Authentication is the only UI needed before a session exists. Keep its
// visual extras out of the entry chunk so a cold anonymous visit does not
// download workspace-only code just to paint the login form.
const AuthFlowBackground = lazy(() => import('../components/auth-flow-background'));
const PasswordResetForm = lazy(() => import('../widgets/password-reset-form'));
// The public gateway is Chinese-only today. Keep its four immediately visible
// labels adjacent to the screen instead of loading the complete workspace
// translation catalog before a session exists.
const AUTH_COPY = Object.freeze({
  username: '用户名',
  password: '密码',
  login: '登录',
  register: '注册',
});

function AuthError({ children }) {
  return (
    <div className="oc-auth-feedback oc-auth-error" role="alert" aria-live="assertive">
      {children}
    </div>
  );
}

function DeferredAuthFlowBackground() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const compact = window.matchMedia?.('(max-width: 699px)').matches ?? false;
    if (compact || globalThis.navigator?.connection?.saveData) return undefined;
    const timer = window.setTimeout(() => setEnabled(true), 600);
    return () => window.clearTimeout(timer);
  }, []);

  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <AuthFlowBackground />
    </Suspense>
  );
}

function formatAuthError(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('user not found')) return '账号不存在，请检查用户名或邮箱';
  if (text.includes('password mismatch')) return '密码错误，请重试';
  if (text.includes('username taken')) return '登录名称已被占用，请换一个';
  if (text.includes('email already')) return '该邮箱已经注册，请直接登录';
  if (text.includes('invalid or expired verification code')) return '验证码无效或已过期';
  if (text.includes('username min 3')) return '登录名称至少 3 个字符';
  if (text.includes('password min 6')) return '密码至少 6 位';
  if (text.includes('failed to send verification code')) return '发送验证码失败，请稍后再试';
  return message || '操作失败，请稍后再试';
}

function PasswordField({ placeholder, value, onChange }) {
  const [visible, setVisible] = useState(false);
  const label = visible ? '隐藏密码' : '显示密码';
  return (
    <div className="oc-auth-password-field">
      <input
        className="oc-auth-input oc-auth-password-input"
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="current-password"
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        onClick={() => setVisible((current) => !current)}
        className="oc-auth-password-toggle"
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

export function AuthView({ mode, setMode, onLogin, onRegister, onAuthenticationIntent }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginName, setLoginName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    try {
      await authApi.sendVerificationCode(email);
      setCountdown(60);
      setError('');
    } catch (cause) {
      setError(formatAuthError(cause?.message));
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      onAuthenticationIntent?.();
      if (mode === 'login') await onLogin(username, password);
      else await onRegister(email, password, loginName, code);
    } catch (cause) {
      setError(formatAuthError(cause?.message));
    }
  };

  const authShell = (content) => (
    <main className="oc-auth">
      <DeferredAuthFlowBackground />
      {content}
    </main>
  );

  if (mode === 'reset') {
    return authShell(
      <div className="oc-auth-card">
        <div className="oc-auth-logo">CatsCo</div>
        <div className="oc-settings-secondary" style={{ marginBottom: 14 }}>
          输入注册邮箱，验证后设置新密码。
        </div>
        <Suspense fallback={<div className="oc-settings-secondary" role="status">正在加载重置表单…</div>}>
          <PasswordResetForm />
        </Suspense>
        <div className="oc-auth-link">
          <span>想起密码了？<a href="#" onClick={(event) => { event.preventDefault(); setMode('login'); }}>返回登录</a></span>
        </div>
      </div>,
    );
  }

  return authShell(
    <form className="oc-auth-card" onSubmit={submit}>
      <div className="oc-auth-logo">CatsCo</div>
      {error && <AuthError>{error}</AuthError>}
      {mode === 'login' ? (
        <>
          <input
            className="oc-auth-input"
            type="text"
            placeholder={AUTH_COPY.username}
            aria-label={AUTH_COPY.username}
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <PasswordField
            placeholder={AUTH_COPY.password}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      ) : (
        <>
          <input
            className="oc-auth-input"
            type="email"
            placeholder="邮箱地址"
            aria-label="邮箱地址"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="oc-auth-code-row">
            <input
              className="oc-auth-input"
              placeholder="邮箱验证码"
              aria-label="邮箱验证码"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button type="button" className="oc-auth-btn" onClick={sendCode} disabled={countdown > 0}>
              {countdown > 0 ? `${countdown}秒` : '发送验证码'}
            </button>
          </div>
          <input
            className="oc-auth-input"
            placeholder="登录名称（可用于登录）"
            aria-label="登录名称（可用于登录）"
            autoComplete="username"
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
          />
          <PasswordField
            placeholder="设置密码（至少6位）"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      )}
      <button className="oc-auth-btn" type="submit">
        {mode === 'login' ? AUTH_COPY.login : AUTH_COPY.register}
      </button>
      <div className="oc-auth-link">
        {mode === 'login' ? (
          <>
            <span>还没有账号？<a href="#" onClick={(event) => { event.preventDefault(); setMode('register'); }}>立即注册</a></span>
            <span className="oc-auth-link-secondary"><a href="#" onClick={(event) => { event.preventDefault(); setMode('reset'); }}>忘记密码？</a></span>
          </>
        ) : (
          <span>已有账号？<a href="#" onClick={(event) => { event.preventDefault(); setMode('login'); }}>立即登录</a></span>
        )}
      </div>
    </form>,
  );
}

export default function AuthGateway({ onAuthenticationIntent }) {
  const [mode, setMode] = useState('login');

  const handleLogin = async (account, password) => {
    const response = await authApi.login({ account, password });
    if (!response?.token) throw new Error('登录响应缺少有效的会话令牌');
    writeStoredUserProfile(response);
    setToken(response.token);
  };

  const handleRegister = async (email, password, loginName, code) => {
    const username = loginName.trim();
    if (!username) throw new Error('请输入登录名称');
    if (username.length < 3) throw new Error('登录名称至少 3 个字符');
    await authApi.register({ email, username, password, code });
    await handleLogin(email, password);
  };

  return (
    <AuthView
      mode={mode}
      setMode={setMode}
      onLogin={handleLogin}
      onRegister={handleRegister}
      onAuthenticationIntent={onAuthenticationIntent}
    />
  );
}
