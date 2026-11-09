'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Network, ShieldCheck, Wifi } from 'lucide-react';
import { api, requestError } from '@/lib/api';
import type { User } from '@/lib/protocol';
import { Brand } from './brand';

export function Auth({ onSuccess, notice }: { onSuccess: (user: User) => void; notice: string | null }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const response = await api<{ user: User }>(`/api/auth/${mode}`, {
        nickname: String(data.get('nickname')).trim(), password: String(data.get('password')),
        ...(mode === 'register' ? { invitation: String(data.get('invitation')).trim() } : {}),
      });
      onSuccess(response.user);
    } catch (reason) { setError(requestError(reason)); } finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <section className="auth-story">
      <Brand dark />
      <div className="story-content">
        <span className="eyebrow"><span className="status-dot" /> ЛОКАЛЬНОЕ ПРОСТРАНСТВО ДЛЯ ОБЩЕНИЯ</span>
        <h1>Свои люди.<br /><span>Своя сеть.</span></h1>
        <p>Обсуждайте идеи, будьте на связи<br className="desktop-break" /> и работайте вместе. Внутри вашей сети.</p>
        <div className="network-art" aria-hidden="true">
          <div className="network-line line-one" /><div className="network-line line-two" /><div className="network-line line-three" />
          <div className="network-node node-one"><span>01</span><Network size={25} /></div>
          <div className="network-core"><Wifi size={36} strokeWidth={1.5} /><span>СВОЯ СЕТЬ</span></div>
          <div className="network-node node-two"><span>02</span><Network size={25} /></div>
          <div className="network-node node-three"><span>03</span><Network size={25} /></div>
          <span className="network-label">Никаких облачных сервисов</span>
        </div>
      </div>
      <div className="story-footer"><span>БЛИЖЕ, ЧЕМ КАЖЕТСЯ.</span><span>LAN / 01</span></div>
    </section>
    <section className="auth-form-panel">
      <div className="auth-topline"><ShieldCheck size={16} /> Внутри локальной сети</div>
      <div className="auth-form-wrap">
        <div className="auth-tabs" aria-label="Способ входа">
          <button type="button" className={mode === 'login' ? 'selected' : ''} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null); }}>Вход</button>
          <button type="button" className={mode === 'register' ? 'selected' : ''} aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(null); }}>Регистрация</button>
        </div>
        <h2>{mode === 'login' ? 'Снова на связи.' : 'Станьте частью сети.'}</h2>
        <p className="auth-description">{mode === 'login' ? 'Войдите, чтобы продолжить разговор.' : 'Для первого входа нужен код приглашения от администратора.'}</p>
        {(error || notice) && <div className="form-error" role="alert">{error || notice}</div>}
        <form onSubmit={submit} key={mode}>
          <label className="field">Ваш ник<input name="nickname" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Например, alex" pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" minLength={3} maxLength={24} required disabled={busy} /><span>От 3 до 24 символов: латиница, цифры и _</span></label>
          <label className="field">Пароль<span className="password-field"><input name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Не менее 12 символов" minLength={12} maxLength={128} required disabled={busy} /><button type="button" className="icon-button" aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          {mode === 'register' && <label className="field">Код приглашения<input type="password" name="invitation" autoComplete="off" placeholder="Код от администратора сети" maxLength={128} required disabled={busy} /></label>}
          <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? 'Подключаемся…' : mode === 'login' ? 'Войти в сеть' : 'Создать аккаунт'}{busy ? <span className="spinner" /> : <ArrowRight size={19} />}</button>
        </form>
        <div className="auth-help"><span className="tiny-rule" />{mode === 'login' ? 'Нет аккаунта?' : 'Уже зарегистрированы?'}<button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>{mode === 'login' ? 'Присоединиться' : 'Войти в сеть'} <ArrowRight size={13} /></button></div>
      </div>
      <p className="auth-footnote"><ShieldCheck size={17} /><span>Соединение защищено TLS. Сквозное шифрование<br className="desktop-break" /> в этой версии пока не поддерживается.</span></p>
    </section>
  </main>;
}
