// Browser contract for project_back/src/protocol.ts. No server code or secrets.
export type Role = 'admin' | 'moderator' | 'member';
export type User = { id: string; nickname: string; role: Role; department: string | null; active: number };
export type Attachment = { id: string; name: string; size: number };
export type Channel = { channel: string; name: string };
export type Member = { nickname: string; prefix: string };
export type Command =
  | { type: 'join' | 'part' | 'names'; channel: string }
  | { type: 'message'; target: string; text: string; attachmentId?: string };
export type ServerEvent =
  | { type: 'ready'; nickname: string }
  | { type: 'message'; from: string; target: string; text: string; time: string; id?: number; attachment?: Attachment }
  | { type: 'join' | 'part'; nickname: string; channel: string }
  | { type: 'quit'; nickname: string }
  | { type: 'names'; channel: string; members: Member[] }
  | { type: 'topic'; channel: string; text: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export const validNickname = (text: string) => /^[a-z][a-z0-9_]{2,23}$/i.test(text);
export const validChannel = (text: string) => /^#[a-z0-9][a-z0-9_-]{0,47}$/.test(text);
export const validMessage = (text: string) => text.trim().length > 0 && byteLength(text) <= 350 && !/[\x00-\x1f\x7f]/.test(text);

const errors: Record<string, string> = {
  FORBIDDEN: 'Недостаточно прав для этого действия.', REGISTRATION_CLOSED: 'Аккаунты создаёт администратор сети.',
  LAST_ADMIN: 'Нельзя отключить или понизить последнего администратора.', NOT_FOUND: 'Объект не найден или недоступен.',
  STORAGE_FULL: 'Хранилище файлов заполнено. Обратитесь к администратору.',
  ALREADY_EXISTS: 'Такой отдел уже существует.', MESSAGE_PENDING: 'Дождитесь подтверждения сообщения.',
  STORAGE_ERROR: 'Не удалось сохранить сообщение. Повторите отправку.', MESSAGE_TIMEOUT: 'Подтверждение не получено. Проверьте историю перед повтором.',
  NOT_JOINED: 'Сначала войдите в чат.',

  INVALID_CREDENTIALS: 'Неверный ник или пароль.', NICKNAME_TAKEN: 'Этот ник уже занят. Выберите другой.',
  INVALID_INPUT: 'Проверьте заполненные поля: формат ника, пароль, роль и отдел.',
  ORIGIN_DENIED: 'Адрес этого интерфейса не разрешён на сервере. Проверьте ALLOWED_ORIGINS.',
  LAN_ONLY: 'Подключение доступно только из локальной сети.',
  UNAUTHORIZED: 'Сессия завершилась. Войдите снова.',
  ALREADY_CONNECTED: 'Аккаунт уже подключён в другой вкладке или на другом устройстве.',
  IRC_401: 'Собеседник сейчас не в сети. Сообщение не доставлено.',
  IRC_404: 'Сначала войдите в комнату, чтобы отправлять сообщения.',
  IRC_405: 'Достигнут лимит: не больше 20 комнат.',
  IRC_433: 'Этот аккаунт уже подключён. Закройте другую вкладку и повторите подключение.',
  IRC_473: 'Для этой комнаты нужно приглашение.', IRC_474: 'Доступ в эту комнату закрыт.',
  IRC_475: 'Эта комната защищена паролем.',
  IRC_UNAVAILABLE: 'Сервер сообщений недоступен.', IRC_DISCONNECTED: 'Связь с сервером сообщений прервалась.',
  IRC_TIMEOUT: 'Сервер сообщений не ответил вовремя.',
  NOT_READY: 'Дождитесь подключения к серверу.',
  INVALID_COMMAND: 'Не удалось отправить команду. Сообщение должно быть одной строкой до 350 байт.',
};
export const errorText = (code: string) => errors[code] ?? 'Сервер не смог выполнить запрос. Попробуйте ещё раз.';
