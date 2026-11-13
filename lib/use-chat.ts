'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, ApiError, socketUrl, uploadFile, requestError } from './api';
import { chatReducer, initialState, type Message } from './chat-state';
import { errorText, validChannel, validMessage, validNickname, type Command, type ServerEvent, type User, type Channel } from './protocol';

export function useChat(user: User, onExpired: () => void) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialState);
  const current = useRef(state);
  current.current = state;
  const ws = useRef<WebSocket | null>(null);
  const [generation, setGeneration] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cursors, setCursors] = useState<Record<string, number | null>>({});
  const [historyBusy, setHistoryBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    if (!state.active || state.status !== 'connected') return;
    const target = state.active;
    setHistoryBusy(true);
    api<{ messages: Message[]; nextBefore: number | null }>(`/api/history?target=${encodeURIComponent(target)}`, undefined, abort.signal)
      .then(page => { dispatch({ type: 'history', target, messages: page.messages }); setCursors(old => ({ ...old, [target]: page.nextBefore })); })
      .catch(error => { if (!abort.signal.aborted) dispatch({ type: 'error', message: requestError(error) }); })
      .finally(() => { if (!abort.signal.aborted) setHistoryBusy(false); });
    return () => abort.abort();
  }, [state.active, state.status]);
  const loadOlder = async () => {
    const target = current.current.active;
    if (!cursors[target] || historyBusy) return;
    setHistoryBusy(true);
    try {
      const page = await api<{ messages: Message[]; nextBefore: number | null }>(`/api/history?target=${encodeURIComponent(target)}&before=${cursors[target]}`);
      dispatch({ type: 'history', target, messages: page.messages });
      setCursors(old => ({ ...old, [target]: page.nextBefore }));
    } catch (error) { dispatch({ type: 'error', message: requestError(error) }); }
    finally { setHistoryBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, delay: number) => {
      const timer = setTimeout(() => { timers.delete(timer); if (!cancelled) fn(); }, delay);
      timers.add(timer);
    };
    const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
    const connect = () => {
      if (cancelled) return;
      dispatch({ type: 'status', status: attempts ? 'reconnecting' : 'connecting' });
      const socket = new WebSocket(socketUrl());
      ws.current = socket;
      later(() => { if (current.current.status !== 'connected') socket.close(); }, 12_000);
      socket.onmessage = ({ data }) => {
        if (cancelled || ws.current !== socket) return;
        let event: ServerEvent;
        try { event = JSON.parse(data); } catch { socket.close(1002); return; }
        if (event.type === 'ready') {
          if (event.nickname !== user.nickname) { onExpired(); return; }
          attempts = 0;
          clearTimers();
          api<{ channels: Channel[]; conversations: string[] }>('/api/directory').then(directory => {
            if (cancelled || ws.current !== socket) return;
            setChannels(directory.channels);
            const allowed = new Set(directory.channels.map(c => c.channel));
            for (const target of Object.keys(current.current.conversations)) {
              if (target.startsWith('#') && !allowed.has(target)) dispatch({ type: 'remove', target });
            }
            dispatch({ type: 'catalog', targets: [...allowed, ...directory.conversations] });
            [...allowed].slice(0, 20).forEach((channel, index) => later(() => {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'join', channel }));
            }, index * 250));
          }).catch(error => dispatch({ type: 'error', message: requestError(error) }));
        }
        dispatch({ type: 'event', event, nickname: user.nickname });
      };
      socket.onerror = () => {}; // Browser hides handshake details; handle close with authenticated HTTP checks.
      socket.onclose = async () => {
        if (cancelled || ws.current !== socket) return;
        clearTimers();
        dispatch({ type: 'status', status: 'reconnecting' });
        try {
          const session = await api<{ user: User }>('/api/auth/me');
          if (cancelled) return;
          if (session.user.id !== user.id) { onExpired(); return; }
          const presence = await api<{ connected: boolean }>('/api/chat/status');
          if (cancelled) return;
          if (presence.connected) {
            dispatch({ type: 'status', status: 'blocked' });
            dispatch({ type: 'error', message: errorText('ALREADY_CONNECTED') });
            return;
          }
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 401) { onExpired(); return; }
        }
        if (attempts >= 6) { dispatch({ type: 'status', status: 'offline' }); return; }
        later(connect, Math.min(8000, 1000 * 2 ** attempts++));
      };
    };
    connect();
    return () => { cancelled = true; clearTimers(); ws.current?.close(1000, 'View closed'); ws.current = null; };
  }, [user.id, user.nickname, generation, onExpired]);

  useEffect(() => {
    if (!state.pending) return;
    const timer = setTimeout(() => dispatch({ type: 'error',
      message: 'Подтверждение не получено. Текст сохранён в поле ввода. Перед повтором проверьте переписку.' }), 8000);
    return () => clearTimeout(timer);
  }, [state.pending]);

  const sendCommand = useCallback((command: Command) => {
    if (ws.current?.readyState !== WebSocket.OPEN || current.current.status !== 'connected') {
      dispatch({ type: 'error', message: 'Сначала дождитесь подключения к сети.' }); return false;
    }
    ws.current.send(JSON.stringify(command));
    return true;
  }, []);
  const open = (target: string) => {
    target = target.toLowerCase();
    if (!(target.startsWith('#') ? validChannel(target) : validNickname(target))) return false;
    if (target.startsWith('#') && !channels.some(c => c.channel === target)) { dispatch({ type: 'error', message: 'Этот чат недоступен.' }); return false; }
    if (target === user.nickname) { dispatch({ type: 'error', message: 'Выберите ник другого участника.' }); return false; }
    if (!current.current.conversations[target] && Object.keys(current.current.conversations).length >= 50) {
      dispatch({ type: 'error', message: 'Закройте один из открытых диалогов.' }); return false;
    }
    if (target.startsWith('#') && !current.current.conversations[target]
      && Object.keys(current.current.conversations).filter(key => key.startsWith('#')).length >= 20) {
      dispatch({ type: 'error', message: 'Можно открыть не больше 20 комнат.' }); return false;
    }
    dispatch({ type: 'open', target });
    if (target.startsWith('#') && !current.current.conversations[target]?.joined) sendCommand({ type: 'join', channel: target });
    return true;
  };
  const leave = (target: string) => {
    if (target.startsWith('#') && current.current.conversations[target]?.joined) sendCommand({ type: 'part', channel: target });
    // Forget desired membership immediately; reconnect must not rejoin a room being left.
    dispatch({ type: 'remove', target });
  };
  const sendMessage = () => {
    const { active, drafts, pending } = current.current;
    const text = drafts[active] ?? '';
    if (pending || !validMessage(text)) return;
    if (sendCommand({ type: 'message', target: active, text })) dispatch({ type: 'sending', target: active, text });
  };
  const sendFile = async (file: File) => {
    const target = current.current.active;
    if (current.current.pending || uploading) return;
    setUploading(true);
    try {
      const attachment = await uploadFile(file, 'chat', target);
      const text = `Документ: ${file.name.slice(0, 60)}`;
      if (sendCommand({ type: 'message', target, text, attachmentId: attachment.id })) dispatch({ type: 'sending', target, text });
    } catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : requestError(error) }); }
    finally { setUploading(false); }
  };
  return { state, dispatch, open, leave, sendMessage, sendFile, uploading, channels, loadOlder, historyBusy,
    hasOlder: Boolean(cursors[state.active]), reconnect: () => setGeneration(value => value + 1) };
}
