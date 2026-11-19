'use client';

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Check, MessageCircle } from 'lucide-react';
import type { Conversation } from '@/lib/chat-state';
import { chatDay, chatTime } from './chat-list';
import { FileLink } from './organization';

export function MessageFeed({ chat, ownName, busy, hasOlder, loadOlder, onDirect }: {
  chat: Conversation; ownName: string; busy: boolean; hasOlder: boolean; loadOlder: () => Promise<void>; onDirect: (nick: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const beforePage = useRef<{ height: number; top: number; first: number } | null>(null);
  const first = chat.messages[0]?.id;
  const last = chat.messages.at(-1)?.id;
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const page = beforePage.current;
    if (page && first !== page.first) {
      el.scrollTop = page.top + el.scrollHeight - page.height;
      beforePage.current = null;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
    if (!busy) beforePage.current = null;
  }, [first, last, busy]);

  function older() {
    if (!list.current || first === undefined || busy) return;
    pinned.current = false;
    beforePage.current = { height: list.current.scrollHeight, top: list.current.scrollTop, first };
    void loadOlder();
  }

  return <>
    <div className="message-scroll" ref={list} onScroll={e => {
      const el = e.currentTarget;
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setAwayFromBottom(!pinned.current);
    }}>
      <div className="feed">
        {hasOlder && <button className="service-label history-button" disabled={busy} onClick={older}>{busy ? 'Загрузка…' : 'Более ранние сообщения'}</button>}
        {busy && !chat.messages.length && <span className="service-label" role="status">Загрузка истории…</span>}
        {!busy && !chat.messages.length && <span className="service-label empty-history"><MessageCircle size={16} /> Здесь пока нет сообщений</span>}
        <div role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions" className="message-log">
          {chat.messages.map((m, i) => {
            const prev = chat.messages[i - 1];
            const next = chat.messages[i + 1];
            const day = chatDay(m.time);
            const newDay = !prev || chatDay(prev.time) !== day;
            const endGroup = !next || next.from !== m.from || chatDay(next.time) !== day || Date.parse(next.time) - Date.parse(m.time) > 180000;
            const own = m.from === ownName;
            const showSender = chat.target.startsWith('#') && !own && (newDay || prev.from !== m.from || Date.parse(m.time) - Date.parse(prev.time) > 180000);
            return <Fragment key={m.id}>
              {newDay && day && <span className="service-label date-chip">{day}</span>}
              <article className={`bubble ${own ? 'outgoing' : 'incoming'} ${endGroup ? 'last-in-group' : ''}`} aria-label={own ? 'Вы' : m.from}>
                {showSender && <button className="sender" onClick={() => onDirect(m.from)}>{m.from}</button>}
                {m.attachment && <FileLink file={m.attachment} />}
                {(!m.attachment || m.text !== `Документ: ${m.attachment.name.slice(0, 60)}`) && <span className="message-text">{m.text}</span>}
                <span className="bubble-meta"><time dateTime={m.time}>{chatTime(m.time)}</time>{own && <Check size={15} aria-label="Принято сервером" />}</span>
              </article>
            </Fragment>;
          })}
        </div>
      </div>
    </div>
    {awayFromBottom && <button className="jump-bottom" aria-label="К последнему сообщению" onClick={() => {
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
    }}><ArrowDown size={20} /></button>}
  </>;
}
