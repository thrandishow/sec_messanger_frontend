import test from 'node:test';
import assert from 'node:assert/strict';
import { chatReducer, initialState, type ChatState } from '../lib/chat-state.ts';
import { byteLength, validMessage, type ServerEvent } from '../lib/protocol.ts';

const event = (state: ChatState, value: ServerEvent) => chatReducer(state, { type: 'event', event: value, nickname: 'alice' });
const message = (from: string, target: string, text: string): ServerEvent => ({ type: 'message', from, target, text, time: '2026-11-09T12:00:00Z' });

test('messages appear only on server echo; failed sends preserve the draft', () => {
  let state = chatReducer(initialState(), { type: 'draft', target: '#general', text: 'Привет' });
  state = chatReducer(state, { type: 'sending', target: '#general', text: 'Привет' });
  assert.equal(state.conversations['#general']!.messages.length, 0);
  state = event(state, { type: 'error', code: 'IRC_404', message: 'Rejected' });
  assert.equal(state.drafts['#general'], 'Привет');
  assert.equal(state.pending, null);
  state = chatReducer(state, { type: 'sending', target: '#general', text: 'Привет' });
  state = event(state, message('alice', '#general', 'Привет'));
  assert.equal(state.drafts['#general'], '');
  assert.equal(state.pending, null);
  assert.equal(state.conversations['#general']!.messages.length, 1);
});

test('incoming DMs and outgoing echoes use the peer conversation; selecting clears unread', () => {
  let state = event(initialState(), message('bob', 'alice', 'Первое'));
  assert.equal(state.conversations.bob!.unread, 1);
  assert.equal(state.conversations.alice, undefined);
  state = chatReducer(state, { type: 'open', target: 'bob' });
  assert.equal(state.conversations.bob!.unread, 0);
  state = event(state, message('alice', 'bob', 'Ответ'));
  assert.deepEqual(state.conversations.bob!.messages.map(m => m.text), ['Первое', 'Ответ']);
});

test('disconnect clears stale membership while preserving rooms, messages and drafts', () => {
  let state = event(initialState(), { type: 'join', nickname: 'alice', channel: '#general' });
  state = event(state, message('bob', '#general', 'Тест'));
  state = chatReducer(state, { type: 'draft', target: '#general', text: 'Ещё не отправлено' });
  state = chatReducer(state, { type: 'status', status: 'reconnecting' });
  assert.equal(state.conversations['#general']!.joined, false);
  assert.equal(state.conversations['#general']!.members.length, 0);
  assert.equal(state.conversations['#general']!.messages.length, 1);
  assert.equal(state.drafts['#general'], 'Ещё не отправлено');
});

test('quit removes a person from all rooms and leave forgets desired membership', () => {
  let state = chatReducer(initialState(), { type: 'open', target: '#team' });
  for (const channel of ['#general', '#team']) state = event(state, { type: 'join', nickname: 'bob', channel });
  state = event(state, { type: 'quit', nickname: 'bob' });
  assert.ok(Object.values(state.conversations).every(c => c.members.length === 0));
  state = chatReducer(state, { type: 'remove', target: '#team' });
  assert.equal(state.active, '#general');
  assert.equal(state.conversations['#team'], undefined);
});

test('valid nicknames cannot collide with inherited JavaScript properties', () => {
  let state = event(initialState(), message('constructor', 'alice', 'Сообщение'));
  const key: string = 'constructor';
  assert.equal(state.conversations[key]!.target, 'constructor');
  state = chatReducer(state, { type: 'draft', target: 'constructor', text: 'Ответ' });
  state = chatReducer(state, { type: 'open', target: 'constructor' });
  assert.equal(state.drafts.constructor, 'Ответ');
  assert.equal(state.conversations[key]!.messages.length, 1);
});

test('loaded history is retained and UTF-8 validation is enforced', () => {
  let state = initialState();
  for (let i = 0; i < 205; i++) state = event(state, message('bob', '#general', String(i)));
  assert.equal(state.conversations['#general']!.messages.length, 205);
  assert.equal(state.conversations['#general']!.messages[0]!.text, '0');
  assert.equal(byteLength('я'), 2);
  assert.equal(validMessage('я'.repeat(175)), true);
  assert.equal(validMessage('я'.repeat(176)), false);
  assert.equal(validMessage('text\r\nJOIN #other'), false);
  assert.equal(validMessage('  '), false);
});


test('history and live events merge by persistent id without duplicates; echo still clears pending', () => {
  let state = initialState();
  state = chatReducer(state, { type: 'draft', target: '#general', text: 'saved' });
  state = chatReducer(state, { type: 'sending', target: '#general', text: 'saved' });
  state = chatReducer(state, { type: 'history', target: '#general', messages: [
    { id: 2, from: 'alice', text: 'saved', time: '2026-11-13T10:00:00Z' },
  ] });
  state = chatReducer(state, { type: 'event', nickname: 'alice', event: { type: 'message', id: 2,
    from: 'alice', target: '#general', text: 'saved', time: '2026-11-13T10:00:00Z' } });
  assert.equal(state.pending, null);
  assert.equal(state.drafts['#general'], '');
  assert.equal(state.conversations['#general']!.messages.length, 1);
  state = chatReducer(state, { type: 'history', target: '#general', messages: [
    { id: 1, from: 'bob', text: 'older', time: '2026-11-13T09:00:00Z' },
    { id: 2, from: 'alice', text: 'saved', time: '2026-11-13T10:00:00Z' },
  ] });
  assert.deepEqual(state.conversations['#general']!.messages.map(m => m.id), [1, 2]);
});
