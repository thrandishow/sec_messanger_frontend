'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, ApiError, socketUrl } from './api';
import { chatReducer, initialState } from './chat-state';
import { errorText, validChannel, validMessage, validNickname, type Command, type ServerEvent, type User } from './protocol';

export function useChat(user: User, onExpired: () => void) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialState);
  const current = useRef(state);
  current.current = state;
  const ws = useRef<WebSocket | null>(null);
  const [generation, setGeneration] = useState(0);

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
          Object.keys(current.current.conversations).filter(key => key.startsWith('#')).forEach((channel, index) => {
            later(() => {
              if (socket.readyState === WebSocket.OPEN && current.current.conversations[channel]) {
                socket.send(JSON.stringify({ type: 'join', channel }));
              }
            }, index * 250);
          });
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
  return { state, dispatch, open, leave, sendMessage, reconnect: () => setGeneration(value => value + 1) };
}
