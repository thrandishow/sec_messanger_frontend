import { errorText, type Member, type ServerEvent, type Attachment } from './protocol.ts';

export type Message = { id: number; from: string; text: string; time: string; attachment?: Attachment };
export type Conversation = { target: string; joined: boolean; members: Member[]; messages: Message[]; unread: number; topic: string };
export type Status = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'blocked';
export type ChatState = { conversations: Record<string, Conversation>; active: string; status: Status;
  error: string | null; drafts: Record<string, string>; pending: { target: string; text: string } | null; sequence: number };
export const conversation = (target: string): Conversation => ({ target, joined: false, members: [], messages: [], unread: 0, topic: '' });
const dict = <T>(entries: Record<string, T>): Record<string, T> => Object.assign(Object.create(null), entries);
export const initialState = (): ChatState => ({ conversations: dict({ '#general': conversation('#general') }), active: '#general',
  status: 'connecting', error: null, drafts: dict({}), pending: null, sequence: 0 });
export type Action =
  | { type: 'history'; target: string; messages: Message[] }
  | { type: 'catalog'; targets: string[] }
  | { type: 'event'; event: ServerEvent; nickname: string }
  | { type: 'status'; status: Status }
  | { type: 'open'; target: string }
  | { type: 'remove'; target: string }
  | { type: 'draft'; target: string; text: string }
  | { type: 'sending'; target: string; text: string }
  | { type: 'error'; message: string | null };

export function chatReducer(state: ChatState, action: Action): ChatState {
  if (action.type === 'catalog') {
    const conversations = dict({ ...state.conversations });
    for (const target of action.targets.slice(0, 50)) conversations[target] ??= conversation(target);
    return { ...state, conversations };
  }
  if (action.type === 'history') {
    const current = state.conversations[action.target];
    if (!current) return state;
    const merged = new Map([...action.messages, ...current.messages].map(m => [m.id, m]));
    return { ...state, conversations: dict({ ...state.conversations,
      [action.target]: { ...current, messages: [...merged.values()].sort((a, b) => a.id - b.id) } }) };
  }
  if (action.type === 'error') return { ...state, error: action.message, pending: null };
  if (action.type === 'draft') return { ...state, drafts: dict({ ...state.drafts, [action.target]: action.text }) };
  if (action.type === 'sending') return { ...state, error: null, pending: { target: action.target, text: action.text } };
  if (action.type === 'status') return { ...state, status: action.status,
    ...(action.status !== 'connected' ? {
      conversations: dict(Object.fromEntries(Object.entries(state.conversations).map(([key, value]) => [key, { ...value, joined: false, members: [] }]))),
      pending: null,
    } : {}) };
  if (action.type === 'open') {
    if (!state.conversations[action.target] && Object.keys(state.conversations).length >= 50) {
      return { ...state, error: 'Достигнут лимит открытых диалогов. Закройте один из них.' };
    }
    return { ...state, active: action.target, conversations: dict({ ...state.conversations,
      [action.target]: { ...(state.conversations[action.target] ?? conversation(action.target)), unread: 0 } }) };
  }
  if (action.type === 'remove') {
    const conversations = dict({ ...state.conversations });
    const drafts = dict({ ...state.drafts });
    delete conversations[action.target]; delete drafts[action.target];
    return { ...state, conversations, drafts, active: state.active === action.target ? Object.keys(conversations)[0] ?? '' : state.active };
  }
  const e = action.event;
  const own = action.nickname;
  if (e.type === 'ready') return { ...state, status: 'connected', error: null };
  if (e.type === 'error') return { ...state, error: errorText(e.code), pending: null };
  if (e.type === 'message') {
    const key = e.target.startsWith('#') ? e.target : e.from === own ? e.target.toLowerCase() : e.from.toLowerCase();
    if (!state.conversations[key] && Object.keys(state.conversations).length >= 50) {
      return { ...state, error: 'Новый диалог не открыт: закройте один из 50 открытых диалогов.' };
    }
    const current = state.conversations[key] ?? conversation(key);
    const confirmed = e.from === own && state.pending?.target === key && state.pending.text === e.text;
    return { ...state, sequence: state.sequence + 1,
      pending: confirmed ? null : state.pending,
      drafts: confirmed && state.drafts[key] === e.text ? dict({ ...state.drafts, [key]: '' }) : state.drafts,
      conversations: dict({ ...state.conversations, [key]: { ...current,
        messages: e.id !== undefined && current.messages.some(m => m.id === e.id) ? current.messages : [...current.messages, { id: e.id ?? state.sequence + 1, from: e.from, text: e.text, time: e.time, ...(e.attachment ? { attachment: e.attachment } : {}) }],
        unread: key !== state.active && e.from !== own && !current.messages.some(m => m.id === e.id) ? current.unread + 1 : current.unread,
      } }) };
  }
  if (e.type === 'quit') return { ...state, conversations: dict(Object.fromEntries(Object.entries(state.conversations)
    .map(([key, value]) => [key, { ...value, members: value.members.filter(m => m.nickname !== e.nickname) }]))) };
  if (e.type === 'join' || e.type === 'part' || e.type === 'names' || e.type === 'topic') {
    const current = state.conversations[e.channel];
    if (!current) return state;
    let next = { ...current };
    if (e.type === 'join') next = { ...current, joined: current.joined || e.nickname === own,
      members: current.members.some(m => m.nickname === e.nickname) ? current.members : [...current.members, { nickname: e.nickname, prefix: '' }] };
    if (e.type === 'part') {
      if (e.nickname === own) return chatReducer(state, { type: 'remove', target: e.channel });
      next.members = current.members.filter(m => m.nickname !== e.nickname);
    }
    if (e.type === 'names') next.members = e.members;
    if (e.type === 'topic') next.topic = e.text;
    return { ...state, conversations: dict({ ...state.conversations, [e.channel]: next }) };
  }
  return state;
}
