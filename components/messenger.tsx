'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, EllipsisVertical, FolderOpen, Info, LockKeyhole, LogOut, MessageCircle, Paperclip, RefreshCw, Search, Send, Settings, ShieldCheck, Users, WifiOff, X } from 'lucide-react';
import { api, ApiError, requestError } from '@/lib/api';
import { byteLength, validMessage, validNickname, type Channel, type User } from '@/lib/protocol';
import { useChat } from '@/lib/use-chat';
import { Avatar, BrandMark } from './brand';
import { ChatList, chatName } from './chat-list';
import { MessageFeed } from './message-feed';
import { Auth } from './auth';
import { Modal } from './modal';
import { Administration, Resources } from './organization';

export function Messenger() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setFailure(null);
    api<{ user: User }>('/api/auth/me', undefined, abort.signal)
      .then(data => setUser(data.user))
      .catch(error => { if (!abort.signal.aborted && !(error instanceof ApiError && error.status === 401)) setFailure(requestError(error)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [attempt]);
  const expired = useCallback(() => { setUser(null); setNotice('Сессия завершилась. Войдите снова.'); }, []);
  if (loading || failure) return <main className="auth-page wallpaper"><section className="auth-card splash" role="status">
    <BrandMark /><h1>Шифр-связь</h1>{failure ? <><p>{failure}</p><button className="primary-button" onClick={() => setAttempt(v => v + 1)}><RefreshCw /> Повторить</button></> :
      <p>Подключаемся к вашей сети…</p>}
  </section></main>;
  if (!user) return <Auth notice={notice} onSuccess={account => { setNotice(null); setUser(account); }} />;
  return <Chat key={user.id} user={user} onExpired={expired} onLogout={() => { setUser(null); setNotice(null); }} />;
}

type Dialog = 'new' | 'profile' | 'participants' | 'options' | 'about' | 'leave' | 'resources' | 'admin';

function Chat({ user, onExpired, onLogout }: { user: User; onExpired: () => void; onLogout: () => void }) {
  const { state, dispatch, open, leave, sendMessage, sendFile, uploading, channels, directoryUsers,
    loadOlder, historyBusy, hasOlder, reconnect } = useChat(user, onExpired);
  const [modal, setModal] = useState<Dialog | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const active = state.conversations[state.active];
  const name = chatName(state.active, channels);
  const isRoom = state.active.startsWith('#');
  const connected = state.status === 'connected';
  const draft = state.drafts[state.active] ?? '';
  const bytes = byteLength(draft);
  const writable = state.active !== '#announcements' || user.role !== 'member';
  const ready = Boolean(active && connected && (!isRoom || active.joined) && writable);
  const pendingHere = state.pending?.target === state.active;
  const canSend = ready && !uploading && !state.pending && validMessage(draft);
  const status = { connecting: 'Подключение…', connected: 'В сети', reconnecting: 'Восстанавливаем связь…', offline: 'Нет подключения', blocked: 'Открыта другая сессия' }[state.status];
  const description = isRoom ? active?.topic || (active?.joined ? `Участников в сети: ${active.members.length}` : 'Групповой чат') : 'Личный диалог';
  function select(target: string) {
    if (!open(target)) return false;
    setModal(null);
    return true;
  }
  async function logout() {
    setLoggingOut(true);
    try { await api('/api/auth/logout', {}); onLogout(); }
    catch (error) { dispatch({ type: 'error', message: requestError(error) }); setModal(null); setLoggingOut(false); }
  }
  const close = () => setModal(null);
  return <main className={`app-shell ${active ? 'has-chat' : ''}`}>
    <ChatList state={state} user={user} channels={channels} status={status}
      onOpen={select} onCompose={() => setModal('new')} onProfile={() => setModal('profile')} onReconnect={reconnect} />
    <section className="chat-pane wallpaper" aria-label="Переписка">
      {active && <header className="chat-header">
        <button className="icon-button back-button" aria-label="Назад к чатам" onClick={() => dispatch({ type: 'deselect' })}><ArrowLeft /></button>
        <button className="chat-identity" onClick={() => setModal(isRoom ? 'participants' : 'options')}>
          <Avatar name={active.target} title={name} /><span><strong>{name}</strong><small>{description}</small></span>
        </button>
        <div className="chat-actions">
          {isRoom && <button className="icon-button" title="Участники" aria-label="Участники" onClick={() => setModal('participants')}><Users /></button>}
          <button className="icon-button" title="Меню чата" aria-label="Меню чата" onClick={() => setModal('options')}><EllipsisVertical /></button>
        </div>
      </header>}
      {!connected && <div className="connection-banner" role="status"><WifiOff size={17} /><span>{state.status === 'blocked' ? 'Этот аккаунт открыт на другом устройстве или в другой вкладке.' : status}</span>
        {['offline', 'blocked'].includes(state.status) && <button onClick={reconnect}>Подключиться снова</button>}</div>}
      {active ? <>
        <MessageFeed key={active.target} chat={active} ownName={user.nickname} busy={historyBusy} hasOlder={hasOlder} loadOlder={loadOlder} onDirect={select} />
        <div className="composer-wrap">
          {!writable ? <div className="readonly"><LockKeyhole size={16} /> Объявления публикуют модераторы и администраторы</div> :
            isRoom && connected && !active.joined ? <button className="primary-button join" onClick={() => open(active.target)}>Войти в группу</button> :
            <form className="composer" onSubmit={e => { e.preventDefault(); if (canSend) sendMessage(); }}>
              <div className={`input-wrap ${bytes > 350 ? 'invalid' : ''}`}>
                <label className="attach-button" title="Прикрепить документ до 10 МиБ"><Paperclip /><input aria-label="Прикрепить документ" type="file"
                  disabled={!ready || uploading || Boolean(state.pending)} onChange={e => { const file = e.target.files?.[0]; if (file) void sendFile(file); e.target.value = ''; }} /></label>
                <input aria-label="Сообщение" placeholder={connected ? 'Сообщение' : 'Нет подключения'} autoComplete="off" value={draft} maxLength={2000}
                  disabled={!ready || uploading || pendingHere} onChange={e => dispatch({ type: 'draft', target: state.active, text: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} />
              </div>
              <button className="send-button" type="submit" title="Отправить" aria-label="Отправить сообщение" disabled={!canSend}><Send size={23} /></button>
            </form>}
          {(uploading || pendingHere || bytes > 300 || (draft && !validMessage(draft))) && <p className="composer-status" role="status">
            {uploading ? 'Загружаем документ…' : pendingHere ? 'Отправляем…' : bytes > 350 ? `Сообщение слишком длинное · ${bytes} / 350 байт` : !validMessage(draft) ? 'Введите текст в одну строку' : `${bytes} / 350 байт`}
          </p>}
        </div>
      </> : <div className="empty-pane"><span className="service-label"><MessageCircle size={18} /> Выберите чат для переписки</span></div>}
    </section>
    {state.error && <div className="chat-error" role="alert"><Info size={18} /><span>{state.error}</span><button className="icon-button" aria-label="Скрыть уведомление" onClick={() => dispatch({ type: 'error', message: null })}><X size={16} /></button></div>}
    {modal === 'new' && <NewChat channels={channels} users={directoryUsers} onOpen={select} onClose={close} />}
    {modal === 'profile' && <Modal title="Профиль" onClose={close}>
      <div className="profile-summary"><Avatar name={user.nickname} /><div><strong>{user.nickname}</strong><small>{status}</small></div></div>
      <button className="menu-row" onClick={() => setModal('resources')}><FolderOpen /> Полезные ресурсы</button>
      {user.role === 'admin' && <button className="menu-row" onClick={() => setModal('admin')}><Settings /> Управление и аудит</button>}
      <button className="menu-row" onClick={() => setModal('about')}><ShieldCheck /> О приватности</button>
      <button className="menu-row danger" disabled={loggingOut} onClick={logout}><LogOut /> Выйти из аккаунта</button>
    </Modal>}
    {modal === 'participants' && active && <Modal title="Участники" onClose={close}>
      <p className="modal-description">{name} · В сети: {active.members.length}</p>
      {active.members.map(m => <button key={m.nickname} className="person-row" disabled={m.nickname === user.nickname} onClick={() => select(m.nickname)}>
        <Avatar name={m.nickname} /><span><strong>{m.nickname}</strong><small>{m.nickname === user.nickname ? 'Вы' : 'В сети'}</small></span></button>)}
      {!active.members.length && <p className="modal-description">Список появится после входа в группу.</p>}
    </Modal>}
    {modal === 'options' && active && <Modal title={name} onClose={close}>
      <p className="modal-description">{description}</p>
      {isRoom && <button className="menu-row" onClick={() => setModal('participants')}><Users /> Участники</button>}
      <button className="menu-row" onClick={() => setModal('about')}><ShieldCheck /> О приватности</button>
      <button className="menu-row danger" onClick={() => setModal('leave')}><LogOut /> {isRoom ? 'Покинуть группу' : 'Закрыть диалог'}</button>
    </Modal>}
    {modal === 'resources' && <Resources user={user} onClose={close} />}
    {modal === 'admin' && user.role === 'admin' && <Administration onChanged={reconnect} onClose={close} />}
    {modal === 'about' && <Modal title="Приватность" onClose={close}><div className="privacy-copy">
      <h3>Локальное соединение</h3><p>HTTPS и WSS защищают трафик между браузером и сервером вашей сети. Сервер обрабатывает текст сообщений.</p>
      <h3>История и документы</h3><p>Переписка и вложения хранятся на локальном сервере. Историю отдела видят его текущие сотрудники и администраторы. Для отправки личного сообщения собеседник должен быть в сети.</p>
      <h3>Устройства</h3><p>Аккаунт поддерживает одно активное подключение. Перед переходом на другое устройство выйдите из аккаунта.</p>
    </div></Modal>}
    {modal === 'leave' && active && <Modal title={isRoom ? 'Покинуть группу?' : 'Закрыть диалог?'} onClose={close}>
      <p className="modal-description">Чат «{name}» закроется в этой вкладке. История останется на сервере.</p>
      <div className="modal-buttons"><button className="secondary-button" onClick={close}>Отмена</button><button className="primary-button" onClick={() => {
        leave(active.target); if (window.matchMedia('(max-width: 760px)').matches) dispatch({ type: 'deselect' }); close();
      }}>{isRoom ? 'Покинуть' : 'Закрыть'}</button></div></Modal>}
  </main>;
}

function NewChat({ channels, users, onOpen, onClose }: { channels: Channel[]; users: string[]; onOpen: (target: string) => boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const term = query.trim().toLowerCase();
  const groups = channels.filter(c => c.channel.includes(term) || c.name.toLowerCase().includes(term));
  const contacts = users.filter(n => n.includes(term));
  function choose(target: string) {
    if (!onOpen(target)) setError('Не удалось открыть чат. Проверьте ник и количество открытых диалогов.');
  }
  return <Modal title="Новый чат" onClose={onClose}>
    <label className="search-box"><Search size={18} /><input autoFocus placeholder="Группа или ник" aria-label="Группа или ник" value={query} onChange={e => { setQuery(e.target.value); setError(''); }} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {groups.length > 0 && <h3 className="group-label">Группы</h3>}
    {groups.map(c => <button key={c.channel} className="person-row" onClick={() => choose(c.channel)}><Avatar name={c.channel} title={c.name} /><span><strong>{c.name}</strong><small>{c.channel}</small></span></button>)}
    {contacts.length > 0 && <h3 className="group-label">Участники сети</h3>}
    {contacts.map(n => <button key={n} className="person-row" onClick={() => choose(n)}><Avatar name={n} /><strong>{n}</strong></button>)}
    {validNickname(term) && !contacts.includes(term) && <button className="menu-row" onClick={() => choose(term)}><MessageCircle /> Написать {term}</button>}
    {!groups.length && !contacts.length && !validNickname(term) && <p className="modal-description">Ничего не найдено</p>}
  </Modal>;
}
