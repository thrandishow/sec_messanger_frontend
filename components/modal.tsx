'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="modal" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-inner"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}><X size={20} /></button></div>{children}</div>
  </dialog>;
}
