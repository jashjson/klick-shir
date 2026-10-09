import type { Song } from './types';

export interface FormatOptions {
  title?: string;
  date?: string;
  showArtist: boolean;
  showLanguage: boolean;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatSetText(songs: Song[], o: FormatOptions): string {
  const head = [o.title?.trim(), o.date ? formatDate(o.date) : ''].filter(Boolean).join(' · ');
  const lines = songs.map((s, i) => {
    const bits = [s.title];
    if (o.showArtist && s.artist) bits.push(`(${s.artist})`);
    if (o.showLanguage && s.language) bits.push(`[${s.language}]`);
    return `${i + 1}. ${bits.join(' ')}`;
  });
  return [head ? `🎵 ${head}` : '🎵 Song set', '', ...lines].join('\n');
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function songsToCSV(songs: Song[]): string {
  const head = ['Title', 'Artist', 'Language', 'Genre', 'Tempo', 'Key', 'Notes'];
  const rows = songs.map((s) => [s.title, s.artist, s.language, s.tags.join(', '), s.tempo, s.key, s.notes].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\n');
}

interface Shared {
  n?: string;
  d?: string;
  s: [string, string, string][];
}

function toB64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSet(songs: Song[], event: string, date: string): string {
  const data: Shared = { n: event || undefined, d: date || undefined, s: songs.map((s) => [s.title, s.artist, s.language]) };
  return toB64Url(JSON.stringify(data));
}

export function decodeSet(hash: string): { event: string; date: string; songs: { title: string; artist: string; language: string }[] } | null {
  try {
    const data = JSON.parse(fromB64Url(hash)) as Shared;
    if (!Array.isArray(data.s)) return null;
    return {
      event: data.n ?? '',
      date: data.d ?? '',
      songs: data.s.map(([title, artist, language]) => ({ title: String(title ?? ''), artist: String(artist ?? ''), language: String(language ?? '') })),
    };
  } catch {
    return null;
  }
}
