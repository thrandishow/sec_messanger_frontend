'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronDown, Hash, Info, LogOut, Menu, MessageCircle, Plus, Search, SendHorizontal, ShieldCheck, Users, Wifi, WifiOff, X, RefreshCw, Paperclip, FolderOpen, Settings } from 'lucide-react';
import { api, ApiError, requestError } from '@/lib/api';
import { byteLength, validChannel, validMessage, validNickname, type User } from '@/lib/protocol';
import { useChat } from '@/lib/use-chat';
import { Brand, Avatar } from './brand';
import { Auth } from './auth';
import { Modal } from './modal';
import { Administration, Resources, FileLink } from './organization';

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
  const expired = useCallback(() => { setUser(null); setNotice('Сессия завершилась. Войдите снова, чтобы продолжить.'); }, []);
  if (loading || failure) return <main className="splash"><Brand /><div className="splash-content">{failure ? <><WifiOff size={32} /><h1>Не удаётся подключиться</h1><p role="alert">{failure}</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={17} /> Повторить</button></> : <><span className="spinner large" /><p>Подключаемся к вашей сети…</p></>}</div><span className="splash-footer">ЛОКАЛЬНО. РЯДОМ. НА СВЯЗИ.</span></main>;
  if (!user) return <Auth notice={notice} onSuccess={account => { setNotice(null); setUser(account); }} />;
  return <Chat key={user.id} user={user} onExpired={expired} onLogout={() => { setUser(null); setNotice(null); }} />;
}

function Chat({ user, onExpired, onLogout }: { user: User; onExpired: () => void; onLogout: () => void }) {
  const { state, dispatch, open, leave, sendMessage, sendFile, uploading, channels, loadOlder, historyBusy, hasOlder, reconnect } = useChat(user, onExpired);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<'room' | 'direct' | 'about' | 'leave' | 'resources' | 'admin' | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [people, setPeople] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const lastActive = useRef('');
  const active = state.conversations[state.active];
  const rooms = Object.values(state.conversations).filter(c => c.target.startsWith('#'));
  const contacts = Object.values(state.conversations).filter(c => !c.target.startsWith('#'));
  const isRoom = active?.target.startsWith('#');
  const connected = state.status === 'connected';
  const draft = state.drafts[state.active] ?? '';
  const bytes = byteLength(draft);
  const writable = state.active !== '#announcements' || user.role !== 'member';
  const canSend = writable && !uploading && connected && active && (!isRoom || active.joined) && !state.pending && validMessage(draft);
  const statusLabel = { connecting: 'Подключение', connected: 'В сети', reconnecting: 'Восстанавливаем связь', offline: 'Нет подключения', blocked: 'Открыта другая сессия' }[state.status];
  useEffect(() => {
    if (lastActive.current !== state.active || nearBottom) {
      list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'instant' });
    }
    lastActive.current = state.active;
  }, [state.active, active?.messages.length, nearBottom]);
  const choose = (target: string) => { dispatch({ type: 'open', target }); setSidebar(false); setPeople(false); setNearBottom(true); };
  const direct = (nickname: string) => { if (open(nickname)) { setPeople(false); setSidebar(false); } };
  async function logout() {
    setLoggingOut(true);
    try { await api('/api/auth/logout', {}); onLogout(); }
    catch (error) { dispatch({ type: 'error', message: requestError(error) }); setLoggingOut(false); }
  }
  const navItem = (target: string, unread: number) => <button key={target} className={`conversation-button ${state.active === target ? 'active' : ''}`} onClick={() => choose(target)} aria-current={state.active === target ? 'page' : undefined}>
    {target.startsWith('#') ? <Hash size={18} /> : <Avatar name={target} small />}<span>{channels.find(c => c.channel === target)?.name ?? target.replace(/^#/, '')}</span>{unread > 0 && <b className="unread" aria-label={`${unread} непрочитанных`}>{unread > 99 ? '99+' : unread}</b>}
  </button>;
  return <main className="app-shell">
    {sidebar && <button className="sidebar-backdrop" aria-label="Скрыть навигацию" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand dark /><button className="icon-button mobile-only" aria-label="Закрыть меню" onClick={() => setSidebar(false)}><X size={20} /></button></div>
      <div className="workspace-badge"><span className="workspace-icon"><Wifi size={20} /></span><div><strong>Локальная сеть</strong><span>Ваше пространство</span></div><span className={`status-dot ${connected ? '' : 'muted-dot'}`} /></div>
      <label className="sidebar-search"><Search size={16} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Найти диалог" aria-label="Найти диалог" />{filter && <button type="button" aria-label="Очистить поиск" onClick={() => setFilter('')}><X size={14} /></button>}</label>
      <div className="sidebar-navigation">
        <div className="section-heading"><span>ЧАТЫ <b>{rooms.length}</b></span><button className="icon-button" title="Выбрать чат" aria-label="Выбрать чат" onClick={() => setModal('room')}><Plus size={17} /></button></div>
        <nav aria-label="Комнаты">{rooms.filter(c => c.target.includes(filter.toLowerCase())).map(c => navItem(c.target, c.unread))}</nav>
        {rooms.length === 0 && <p className="sidebar-empty">Выберите доступный чат организации.</p>}
        <button className="sidebar-add" onClick={() => setModal('room')}><Plus size={16} /> Выбрать чат</button>
        <div className="section-heading direct-heading"><span>ЛИЧНЫЕ СООБЩЕНИЯ <b>{contacts.length}</b></span><button className="icon-button" aria-label="Новый личный диалог" title="Новый диалог" onClick={() => setModal('direct')}><Plus size={17} /></button></div>
        <nav aria-label="Личные сообщения">{contacts.filter(c => c.target.includes(filter.toLowerCase())).map(c => navItem(c.target, c.unread))}</nav>
        {contacts.length === 0 && <div className="direct-empty"><MessageCircle size={21} /><p>Разговор один на один.<br />Начните с ника собеседника.</p><button onClick={() => setModal('direct')}>Написать сообщение <ArrowRight size={13} /></button></div>}
        {filter && ![...rooms, ...contacts].some(c => c.target.includes(filter.toLowerCase())) && <p className="sidebar-empty">По запросу «{filter}» ничего не найдено.</p>}
      </div>
      <button className="sidebar-add" onClick={() => setModal('resources')}><FolderOpen size={17} /> Полезные ресурсы</button>
      {user.role === 'admin' && <button className="sidebar-add" onClick={() => setModal('admin')}><Settings size={17} /> Управление и аудит</button>}
      <button className="local-note" onClick={() => setModal('about')}><ShieldCheck size={17} /><span>Только внутри вашей сети</span><Info size={14} /></button>
      <div className="profile"><Avatar name={user.nickname} /><div><strong>{user.nickname}</strong><span><span className={`status-dot ${connected ? '' : 'muted-dot'}`} />{statusLabel}</span></div><button className="icon-button" title="Выйти из аккаунта" aria-label="Выйти из аккаунта" disabled={loggingOut} onClick={logout}><LogOut size={18} /></button></div>
    </aside>

    <section className="chat-layout">
      <header className="chat-header"><button className="icon-button mobile-only" aria-label="Открыть меню" onClick={() => setSidebar(true)}><Menu size={22} /></button>
        <span className="channel-icon">{isRoom ? <Hash size={26} /> : <MessageCircle size={23} />}</span>
        <div className="channel-heading"><h1>{active ? (channels.find(c => c.channel === active.target)?.name ?? active.target.replace(/^#/, '')) : 'Ваши разговоры'}</h1><span>{isRoom ? active?.topic || 'Общее пространство для общения' : active ? 'Личный диалог' : 'Выберите комнату или собеседника'}</span></div>
        <span className={`connection-pill ${connected ? '' : 'connection-pending'}`}><span className="status-dot" />{statusLabel}</span>
        {isRoom && <button className={`icon-button people-toggle ${people ? 'is-active' : ''}`} aria-label="Показать участников" aria-expanded={people} onClick={() => setPeople(!people)}><Users size={20} /><span>{active?.members.length ?? 0}</span></button>}
        {active && <button className="icon-button" aria-label={isRoom ? 'Покинуть комнату' : 'Закрыть диалог'} title={isRoom ? 'Покинуть комнату' : 'Закрыть диалог'} onClick={() => setModal('leave')}><LogOut size={18} /></button>}
      </header>
      <div className="chat-workspace"><section className="conversation">
        {!connected && <div className="connection-banner" role="status"><WifiOff size={17} /><span>{state.status === 'blocked' ? 'Закройте другую вкладку или устройство с этим аккаунтом.' : state.status === 'offline' ? 'Нет связи с сервером. Сообщения не отправляются.' : 'Подключаемся к серверу. Комнаты восстановятся автоматически.'}</span>{['offline', 'blocked'].includes(state.status) && <button onClick={reconnect}>Подключиться снова</button>}</div>}
        {state.error && <div className="chat-error" role="alert"><Info size={17} /><span>{state.error}</span><button className="icon-button" aria-label="Скрыть уведомление" onClick={() => dispatch({ type: 'error', message: null })}><X size={16} /></button></div>}
        <div className="message-scroll" ref={list} onScroll={event => { const el = event.currentTarget; setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100); }}>
          {active ? <>
            <div className="conversation-intro"><span className="intro-icon">{isRoom ? <Hash size={34} strokeWidth={1.4} /> : <MessageCircle size={31} strokeWidth={1.4} />}</span><span className="eyebrow light-eyebrow">НАЧАЛО РАЗГОВОРА</span><h2>{isRoom ? <>Добро пожаловать в <span>#{active.target.slice(1)}</span></> : <>На связи с <span>{active.target}</span></>}</h2><p>{isRoom ? 'Место для идей, вопросов и разговоров с вашей командой.' : 'Личные сообщения доступны, когда собеседник подключён к сети.'}<br />История сохраняется на сервере вашей сети.</p>{isRoom && !active.joined && connected && <button className="secondary-button" onClick={() => open(active.target)}>Войти в комнату</button>}</div>
            {active.messages.length > 0 && <div className="message-divider"><span>История переписки</span></div>}
            {historyBusy && <p role="status">Загружаем историю…</p>}
            {hasOlder && <button className="secondary-button" disabled={historyBusy} onClick={() => { setNearBottom(false); void loadOlder(); }}>Более ранние сообщения</button>}
            <div className="message-list" role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions">
              {active.messages.map((message, index) => {
                const previous = active.messages[index - 1];
                const compact = previous?.from === message.from && Date.parse(message.time) - Date.parse(previous.time) < 120000;
                const time = new Date(message.time);
                return <article className={`message ${compact ? 'message-compact' : ''} ${message.from === user.nickname ? 'own-message' : ''}`} key={message.id}>
                  {!compact ? <Avatar name={message.from} /> : <span className="avatar-placeholder" />}
                  <div className="message-content">{!compact && <div className="message-meta"><button disabled={message.from === user.nickname} onClick={() => direct(message.from)}>{message.from}</button>{message.from === user.nickname && <span className="you-label">вы</span>}<time dateTime={message.time} title={Number.isNaN(time.getTime()) ? '' : time.toLocaleString('ru-RU')}>{Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>{message.from === user.nickname && <Check size={13} aria-label="Принято сервером" />}</div>}<p>{message.text}</p>{message.attachment && <FileLink file={message.attachment} />}</div>
                </article>;
              })}
            </div>
          </> : <div className="no-conversation"><MessageCircle size={40} strokeWidth={1.2} /><h2>Хороший разговор<br />начинается с «привет».</h2><p>Выберите чат или напишите участнику вашей сети.</p><button className="primary-button" onClick={() => setModal('room')}><Plus size={17} /> Выбрать чат</button></div>}
        </div>
        {!nearBottom && <button className="jump-bottom" onClick={() => { setNearBottom(true); list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown size={16} /> К новым сообщениям</button>}
        {active && <div className="composer-wrap"><form className={`composer ${bytes > 350 ? 'composer-invalid' : ''}`} onSubmit={event => { event.preventDefault(); sendMessage(); }}><label className="attach-button" title="Прикрепить документ (до 10 МиБ)"><Paperclip size={20} /><input type="file" aria-label="Прикрепить документ" disabled={!writable || !connected || uploading || Boolean(state.pending) || Boolean(isRoom && !active.joined)} onChange={e => { const file = e.target.files?.[0]; if (file) void sendFile(file); e.target.value = ''; }} /></label><input aria-label="Сообщение" placeholder={!writable ? 'Объявления публикуют только модераторы' : connected ? `Написать ${isRoom ? 'в ' : ''}${active.target}…` : 'Дождитесь подключения…'} value={draft} maxLength={2000} disabled={!writable || uploading || !connected || (isRoom && !active.joined) || Boolean(state.pending?.target === state.active)} onChange={event => dispatch({ type: 'draft', target: state.active, text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} autoComplete="off" /><button type="submit" className="send-button" disabled={!canSend} aria-label="Отправить сообщение">{state.pending?.target === state.active ? <span className="spinner" /> : <SendHorizontal size={21} />}</button></form><div className="composer-meta"><span>{uploading ? 'Загружаем документ…' : state.pending?.target === state.active ? 'Ожидаем подтверждение сервера…' : bytes > 350 ? 'Сообщение слишком длинное' : 'Enter — отправить'}{bytes > 0 && !validMessage(draft) && bytes <= 350 ? ' · Нужен текст в одну строку' : ''}</span><span className={bytes > 350 ? 'over-limit' : ''}>{bytes} / 350 байт</span></div></div>}
      </section>
      {isRoom && active && <aside className={`members-panel ${people ? 'members-open' : ''}`}><div className="members-heading"><span>В КОМНАТЕ</span><b>{active.members.length}</b><button className="icon-button members-close" aria-label="Скрыть участников" onClick={() => setPeople(false)}><X size={18} /></button></div><p className="members-subtitle">Люди, которые сейчас рядом</p><div className="member-list">{active.members.map(member => <button className="member" key={member.nickname} disabled={member.nickname === user.nickname} onClick={() => direct(member.nickname)}><span className="member-avatar"><Avatar name={member.nickname} /><span className="status-dot" /></span><span><strong>{member.nickname}{member.nickname === user.nickname && <small>вы</small>}</strong><span>Участник</span></span>{member.nickname !== user.nickname && <MessageCircle size={15} className="member-message-icon" />}</button>)}</div>{active.members.length === 0 && <p className="members-empty">{connected ? 'Ожидаем вход в комнату…' : 'Участники появятся после подключения.'}</p>}<div className="members-tip"><span className="tip-symbol"><Users size={24} strokeWidth={1.3} /></span><h3>Вместе — ближе.</h3><p>Поделитесь названием комнаты с коллегами в вашей сети.</p><span className="room-tag">{active.target}</span></div><button className="privacy-link" onClick={() => setModal('about')}><ShieldCheck size={15} /> Как устроена приватность <ArrowRight size={13} /></button></aside>}
      </div>
    </section>
    {modal === 'resources' && <Resources user={user} onClose={() => setModal(null)} />}
    {modal === 'admin' && user.role === 'admin' && <Administration onChanged={reconnect} onClose={() => setModal(null)} />}
    {modal === 'room' && <Modal title="Чаты организации" onClose={() => setModal(null)}><p className="modal-description">Доступные чаты. Отделы и состав сотрудников настраивает администратор.</p>{channels.map(c => <button className="org-user" key={c.channel} onClick={() => { if (open(c.channel)) setModal(null); }}><strong>{c.name}</strong><span>{c.channel}{c.channel === '#announcements' ? ' · Пишут модераторы' : ''}</span></button>)}</Modal>}
    {modal === 'direct' && <NewConversation kind={modal} onClose={() => setModal(null)} onOpen={target => { if (!open(target)) return false; setModal(null); setSidebar(false); setNearBottom(true); return true; }} />}
    {modal === 'about' && <Modal title="Своя сеть. Понятные границы." onClose={() => setModal(null)}><div className="privacy-copy"><ShieldCheck size={34} /><p>Шифр-связь работает на сервере вашей локальной сети и не использует облачные сервисы.</p><h3>Соединение защищено</h3><p>HTTPS и WSS шифруют трафик между браузером и сервером. Сквозного шифрования пока нет: сервер обрабатывает текст сообщений.</p><h3>История и документы на сервере</h3><p>Переписка сохраняется в SQLite и доступна после повторного входа. Документы до 10 МиБ доступны участникам диалога. Историю отдела видят его текущие сотрудники и администраторы. Для отправки личного сообщения собеседник должен быть онлайн.</p><h3>Один аккаунт — одно подключение</h3><p>Чтобы перейти на другое устройство, выйдите здесь из аккаунта.</p></div><button className="primary-button modal-action" onClick={() => setModal(null)}>Понятно <Check size={17} /></button></Modal>}
    {modal === 'leave' && active && <Modal title={isRoom ? 'Покинуть комнату?' : 'Закрыть диалог?'} onClose={() => setModal(null)}><p className="modal-description">Диалог «{active.target}» закроется в этой вкладке. История на сервере сохранится.</p><div className="modal-buttons"><button className="secondary-button" onClick={() => setModal(null)}>Остаться</button><button className="primary-button" onClick={() => { leave(active.target); setModal(null); }}> {isRoom ? 'Покинуть' : 'Закрыть'}</button></div></Modal>}
  </main>;
}

function NewConversation({ kind, onClose, onOpen }: { kind: 'room' | 'direct'; onClose: () => void; onOpen: (target: string) => boolean }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const target = kind === 'room' ? `#${value.trim().toLowerCase().replace(/^#/, '')}` : value.trim().toLowerCase();
    if (!(kind === 'room' ? validChannel(target) : validNickname(target))) {
      setError(kind === 'room' ? 'От 1 до 48 символов: латиница, цифры, _ и -. Первый символ — буква или цифра.' : 'Ник: от 3 до 24 символов, первая — латинская буква, далее буквы, цифры или _.');
      return;
    }
    if (!onOpen(target)) setError('Не удалось открыть диалог. Проверьте ник и количество открытых комнат.');
  }
  return <Modal title={kind === 'room' ? 'Место для вашего разговора' : 'Начать личный разговор'} onClose={onClose}><p className="modal-description">{kind === 'room' ? 'Войдите в существующую комнату или создайте новую. Достаточно её названия.' : 'Введите ник участника вашей сети. Чтобы получать сообщения, он должен быть онлайн.'}</p><form onSubmit={submit}><label className="field">{kind === 'room' ? 'Название комнаты' : 'Ник собеседника'}<span className="prefixed-input"><span>{kind === 'room' ? <Hash size={18} /> : <MessageCircle size={18} />}</span><input autoFocus value={value} onChange={event => { setValue(event.target.value); setError(''); }} placeholder={kind === 'room' ? 'design-team' : 'alex'} maxLength={kind === 'room' ? 49 : 24} autoCapitalize="none" autoComplete="off" spellCheck={false} required /></span></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button modal-action" type="submit">{kind === 'room' ? 'Войти в комнату' : 'Открыть диалог'} <ArrowRight size={17} /></button></form></Modal>;
}
