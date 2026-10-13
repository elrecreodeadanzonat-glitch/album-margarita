/** «ahora», «hace 5 minutos», «ayer», «12 de octubre» — for comments */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'ahora';
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 7 * 86_400) return rtf.format(-Math.round(s / 86_400), 'day');
  return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'long', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}
