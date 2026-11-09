import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Шифр-связь · Своя сеть',
  description: 'Мессенджер для общения в локальной сети.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
