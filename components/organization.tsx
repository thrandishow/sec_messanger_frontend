'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import { api, fileUrl, requestError, uploadFile } from '@/lib/api';
import type { Attachment, Channel, Role, User } from '@/lib/protocol';
import { Modal } from './modal';

const roles: Record<Role, string> = { admin: 'Администратор', moderator: 'Модератор', member: 'Сотрудник' };
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} КиБ` : `${(size / 1024 / 1024).toFixed(1)} МиБ`;
export function FileLink({ file }: { file: Attachment }) {
  return <a className="file-link" href={fileUrl(file.id)} download><FileText size={20} /><span>{file.name}<small>{sizeLabel(file.size)}</small></span><Download size={16} /></a>;
}
export function Resources({ user, onClose }: { user: User; onClose: () => void }) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => setFiles((await api<{ files: Attachment[] }>('/api/resources')).files);
  useEffect(() => { refresh().catch(e => setError(requestError(e))).finally(() => setLoading(false)); }, []);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try { await uploadFile(file, 'resource'); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : requestError(e)); }
    finally { setBusy(false); }
  }
  async function remove(file: Attachment) {
    if (!window.confirm(`Удалить ресурс «${file.name}»?`)) return;
    setBusy(true); setError('');
    try { await api(`/api/resources/${file.id}/delete`, {}); await refresh(); }
    catch (e) { setError(requestError(e)); } finally { setBusy(false); }
  }
  return <Modal title="Полезные ресурсы" onClose={onClose}>
    <p className="modal-description">Шаблоны, инструкции и графики вашей организации. Файлы хранятся на локальном сервере.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {user.role !== 'member' && <label className="field">Добавить документ (до 10 МиБ)<input type="file" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>}
    {loading ? <p role="status">Загружаем ресурсы…</p> : !files.length && <p>Документов пока нет. Их публикует модератор.</p>}
    <div className="resource-list">{files.map(file => <div key={file.id} className="resource-item"><FileLink file={file} />{user.role !== 'member' && <button className="icon-button" disabled={busy} aria-label={`Удалить ${file.name}`} onClick={() => remove(file)}><Trash2 size={16} /></button>}</div>)}</div>
    {busy && <p role="status">Сохраняем изменения…</p>}
  </Modal>;
}

type Audit = { id: number; time: string; nickname: string | null; action: string; subject: string | null; ip: string };
const actions: Record<string, string> = { 'auth.login': 'Вход', 'auth.login_failed': 'Неудачный вход', 'auth.logout': 'Выход',
  'user.create': 'Создание аккаунта', 'user.update': 'Изменение аккаунта', 'file.upload': 'Загрузка файла',
  'file.download': 'Скачивание файла', 'resource.delete': 'Удаление ресурса', 'department.create': 'Создание отдела', 'admin.bootstrap': 'Первый администратор' };
export function Administration({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'users' | 'departments' | 'audit'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Channel[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [entries, setEntries] = useState<Audit[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh() {
    const data = await api<{ users: User[]; departments: Channel[] }>('/api/admin/users');
    setUsers(data.users); setDepartments(data.departments);
  }
  async function loadAudit(cursor?: number) {
    const page = await api<{ entries: Audit[]; nextBefore: number | null }>(`/api/admin/audit${cursor ? `?before=${cursor}` : ''}`);
    setEntries(old => cursor ? [...old, ...page.entries] : page.entries); setBefore(page.nextBefore);
  }
  useEffect(() => { setBusy(true); refresh().catch(e => setError(requestError(e))).finally(() => setBusy(false)); }, []);
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(requestError(e)); } finally { setBusy(false); }
  }
  function submitUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
    const body = { role: String(data.get('role')), department: data.get('department') || null,
      ...(editing ? { active: data.get('active') === 'on', ...(data.get('password') ? { password: String(data.get('password')) } : {}) }
        : { nickname: String(data.get('nickname')), password: String(data.get('password')) }) };
    void run(async () => { await api(editing ? `/api/admin/users/${editing.id}` : '/api/admin/users', body);
      setEditing(null); form.reset(); await refresh(); onChanged(); setNotice('Аккаунт сохранён. Изменённый пользователь должен войти заново.'); });
  }
  function submitDepartment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
    void run(async () => { await api('/api/admin/departments', { name: String(data.get('name')), channel: `#${String(data.get('channel')).replace(/^#/, '')}` });
      form.reset(); await refresh(); onChanged(); setNotice('Отдел создан. Назначьте ему сотрудников.'); });
  }
  return <Modal title="Управление организацией" onClose={onClose}>
    <div className="org-tabs" role="group" aria-label="Раздел администрирования">{(['users', 'departments', 'audit'] as const).map(t => <button key={t} className={tab === t ? 'selected' : ''} onClick={() => { setTab(t); if (t === 'audit') void run(() => loadAudit()); }}>{({ users: 'Сотрудники', departments: 'Отделы', audit: 'Аудит' })[t]}</button>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status" className="org-notice">{notice}</p>}
    {tab === 'users' && <>
      <h3>{editing ? `Изменить ${editing.nickname}` : 'Создать аккаунт'}</h3>
      <form onSubmit={submitUser} key={editing?.id ?? 'new'}>
        <fieldset disabled={busy} className="org-fields">
          {!editing && <label className="field">Ник<input name="nickname" pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" required autoComplete="off" /></label>}
          <label className="field">{editing ? 'Новый пароль (оставьте пустым, чтобы сохранить)' : 'Пароль'}<input name="password" type="password" minLength={12} maxLength={128} required={!editing} autoComplete="new-password" /></label>
          <label className="field">Роль<select name="role" defaultValue={editing?.role ?? 'member'}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="field">Отдел<select name="department" defaultValue={editing?.department ?? ''}><option value="">Без отдела</option>{departments.map(d => <option value={d.channel} key={d.channel}>{d.name}</option>)}</select></label>
          {editing && <label className="org-checkbox"><input name="active" type="checkbox" defaultChecked={Boolean(editing.active)} /> Аккаунт активен</label>}
          <div className="modal-buttons">{editing && <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Отмена</button>}<button className="primary-button" type="submit"><Plus size={16} />{editing ? 'Сохранить' : 'Создать аккаунт'}</button></div>
        </fieldset>
      </form>
      <h3>Сотрудники · {users.length}</h3><div className="org-user-list">{users.map(u => <button className="org-user" key={u.id} disabled={busy} onClick={() => { setEditing(u); setNotice(''); }}><strong>{u.nickname}</strong><span>{roles[u.role]} · {departments.find(d => d.channel === u.department)?.name ?? 'Без отдела'}{!u.active ? ' · Заблокирован' : ''}</span><small>Изменить</small></button>)}</div>
    </>}
    {tab === 'departments' && <><p className="modal-description">Каждому отделу соответствует закрытый групповой чат. Его историю видят сотрудники отдела и администраторы.</p><form onSubmit={submitDepartment}><fieldset disabled={busy} className="org-fields"><label className="field">Название отдела<input name="name" maxLength={80} required placeholder="Бухгалтерия" /></label><label className="field">Адрес чата<input name="channel" pattern="[a-z0-9][a-z0-9_-]{0,47}" required placeholder="accounting" /></label><button className="primary-button" type="submit">Создать отдел</button></fieldset></form>{departments.map(d => <p className="org-notice" key={d.channel}>{d.name} <small>{d.channel}</small></p>)}</>}
    {tab === 'audit' && <><p className="modal-description">Входы, операции с аккаунтами и документами. Пароли и тексты сообщений сюда не записываются.</p><button className="secondary-button" disabled={busy} onClick={() => run(() => loadAudit())}>Обновить журнал</button><div className="audit-list">{entries.map(a => <article key={a.id}><strong>{actions[a.action] ?? a.action}</strong><time>{new Date(a.time).toLocaleString('ru-RU')}</time><p>{a.nickname ?? 'Неавторизован'} · {a.ip}</p><code>{a.subject}</code></article>)}</div>{!busy && !entries.length && <p>Журнал пока пуст.</p>}{before && <button className="secondary-button" disabled={busy} onClick={() => run(() => loadAudit(before))}>Более ранние события</button>}</>}
    {busy && <p role="status">Выполняем запрос…</p>}
  </Modal>;
}
