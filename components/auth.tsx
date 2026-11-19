'use client';

import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { api, requestError } from '@/lib/api';
import type { User } from '@/lib/protocol';
import { BrandMark } from './brand';

export function Auth({ onSuccess, notice }: { onSuccess: (user: User) => void; notice: string | null }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>('/api/auth/login', {
        nickname: String(data.get('nickname')).trim(), password: String(data.get('password')),
      });
      onSuccess(user);
    } catch (reason) {
      setError(requestError(reason));
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page wallpaper">
    <section className="auth-card">
      <BrandMark />
      <h1>Шифр-связь</h1>
      <p className="auth-description">Войдите с учётной записью вашей локальной сети.</p>
      <form onSubmit={submit}>
        {(error || notice) && <p className="form-error" role="alert">{error || notice}</p>}
        <label className="field">Ник<input name="nickname" autoComplete="username" autoCapitalize="none" spellCheck={false}
          placeholder="Ваш ник" pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" minLength={3} maxLength={24} required disabled={busy} /></label>
        <label className="field">Пароль<span className="password-field">
          <input name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Ваш пароль"
            minLength={12} maxLength={128} required disabled={busy} />
          <button type="button" className="icon-button" aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setVisible(!visible)}>
            {visible ? <EyeOff /> : <Eye />}
          </button>
        </span></label>
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Подключаемся…' : 'Войти'}</button>
      </form>
      <p className="auth-help">Аккаунт выдаёт администратор сети.</p>
    </section>
    <span className="auth-network"><LockKeyhole size={14} /> Локальная сеть</span>
  </main>;
}
