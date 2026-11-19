import { Hash, Megaphone, MessagesSquare } from 'lucide-react';

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Hash strokeWidth={2.6} /></span>;
}

export function Avatar({ name, title = name }: { name: string; title?: string }) {
  const tone = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;
  const kind = name === '#general' ? 'general' : name === '#announcements' ? 'announcements' : tone;
  const initials = title.trim().split(/[\s_-]+/).filter(Boolean);
  const letters = initials.slice(0, 2).map(word => word.charAt(0)).join('');
  return <span aria-hidden="true" className={`avatar tone-${kind}`}>
    {name === '#general' ? <MessagesSquare /> : name === '#announcements' ? <Megaphone /> : letters.toLocaleUpperCase('ru')}
  </span>;
}
