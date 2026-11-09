export function Brand({ dark = false }: { dark?: boolean }) {
  return <div className={`brand ${dark ? 'brand-on-dark' : ''}`}>
    <span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M13 5v30M27 5v30M5 14h30M5 26h30" /></svg></span>
    <span>шифр<span className="brand-separator">/</span>связь<span className="brand-caption">СВОЯ СЕТЬ. СВОИ ЛЮДИ.</span></span>
  </div>;
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const tone = [...name].reduce((value, char) => value + char.charCodeAt(0), 0) % 5;
  return <span aria-hidden="true" className={`avatar tone-${tone} ${small ? 'avatar-small' : ''}`}>{name.slice(0, 2).toUpperCase()}</span>;
}
