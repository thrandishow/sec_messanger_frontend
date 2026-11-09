import { errorText } from './protocol';

const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(status === 429 ? 'Слишком много попыток. Подождите минуту и попробуйте снова.' : errorText(code));
  }
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof data.error === 'string' ? data.error : 'UNAVAILABLE');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export function socketUrl() {
  const url = new URL('/ws', base || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
export const requestError = (error: unknown) => error instanceof ApiError ? error.message
  : 'Не удалось связаться с сервером. Проверьте сеть и доверие локальному сертификату.';
