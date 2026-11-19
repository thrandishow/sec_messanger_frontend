'use client';

import { useState } from 'react';
import { ChevronRight, Menu, Search, SquarePen, X } from 'lucide-react';
import type { Channel, User } from '@/lib/protocol';
import type { ChatState, Conversation } from '@/lib/chat-state';
import { Avatar } from './brand';

export function chatName(target: string, channels: Channel[]) {
  return channels.find(c => c.channel === target)?.name ?? target.replace(/^#/, '');
}

export function chatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

export function chatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function summary(chat: Conversation, draft: string, own: string) {
  if (draft) return <><em>Черновик:</em> {draft}</>;
  const last = chat.messages.at(-1);
  if (!last) return chat.topic || (chat.target.startsWith('#') ? 'Групповой чат' : 'Личный диалог');
  const author = last.from === own ? 'Вы' : chat.target.startsWith('#') ? last.from : '';
  return <>{author && <b>{author}: </b>}{last.attachment ? '📎 ' + last.attachment.name : last.text}</>;
}

const filters = { all: 'Все чаты', groups: 'Группы', direct: 'Личные' } as const;

export function ChatList({ state, user, channels, status, onOpen, onCompose, onProfile, onReconnect }: {
  state: ChatState; user: User; channels: Channel[]; status: string;
  onOpen: (target: string) => void; onCompose: () => void; onProfile: () => void; onReconnect: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<keyof typeof filters>('all');
  const needle = query.toLocaleLowerCase('ru').trim();
  const items = Object.values(state.conversations).filter(c => {
    const group = c.target.startsWith('#');
    const name = chatName(c.target, channels).toLocaleLowerCase('ru');
    return (filter === 'all' || (filter === 'groups') === group) && (name.includes(needle) || c.target.includes(needle));
  }).sort((a, b) => (b.messages.at(-1)?.id ?? 0) - (a.messages.at(-1)?.id ?? 0));

  return <aside className="sidebar" aria-label="Список чатов">
    <header className="sidebar-top">
      <button className="icon-button" aria-label="Меню профиля" title="Меню профиля" onClick={onProfile}><Menu /></button>
      <h1>Чаты</h1>
      <button className="icon-button new-chat" aria-label="Новый чат" title="Новый чат" onClick={onCompose}><SquarePen /></button>
    </header>
    <div className="sidebar-tools">
      <label className="search-box"><Search size={18} /><input aria-label="Поиск чатов" placeholder="Поиск" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button type="button" aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={16} /></button>}
      </label>
      <div className="filters" role="group" aria-label="Тип диалога">
        {(Object.keys(filters) as (keyof typeof filters)[]).map(key => <button key={key} aria-pressed={key === filter}
          onClick={() => setFilter(key)}>{filters[key]}</button>)}
      </div>
    </div>
    <nav className="threads" aria-label="Диалоги">
      {items.map(chat => {
        const name = chatName(chat.target, channels);
        const last = chat.messages.at(-1);
        const day = last && chatDay(last.time);
        return <button key={chat.target} className="thread" aria-current={chat.target === state.active ? 'page' : undefined} onClick={() => onOpen(chat.target)}>
          <Avatar name={chat.target} title={name} />
          <span className="thread-lines">
            <span className="thread-top"><strong>{name}</strong>{last && <time dateTime={last.time}>{day === 'Сегодня' ? chatTime(last.time) : day}</time>}</span>
            <span className="thread-bottom"><span className="preview">{summary(chat, state.drafts[chat.target] ?? '', user.nickname)}</span>
              {chat.unread > 0 && <span className="unread" aria-label={`Непрочитанных: ${chat.unread}`}>{chat.unread > 99 ? '99+' : chat.unread}</span>}
            </span>
          </span>
        </button>;
      })}
      {!items.length && <div className="list-empty"><p>{needle ? 'Чаты не найдены' : 'Пока нет диалогов'}</p>
        <button onClick={needle ? () => setQuery('') : onCompose}>{needle ? 'Очистить поиск' : 'Начать разговор'}</button></div>}
    </nav>
    <footer className="profile-bar">
      <button className="profile-button" onClick={onProfile}><Avatar name={user.nickname} />
        <span><strong>{user.nickname}</strong><small><i className={state.status === 'connected' ? 'online' : 'away'} />{status}</small></span><ChevronRight size={16} />
      </button>
      {['offline', 'blocked'].includes(state.status) && <button className="text-button" onClick={onReconnect}>Подключиться снова</button>}
    </footer>
  </aside>;
}
