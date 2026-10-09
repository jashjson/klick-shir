import { normalizeLanguage, normalizeTags, normalizeTempo } from './classify';
import type { ParsedRow } from './types';

export type DashMode = 'title-artist' | 'artist-title' | 'none';

export interface ParseOptions {
  dashMode: DashMode;
  /** treat every line as one song, even if commas/tabs look like columns */
  forceLines?: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  format: 'table' | 'lines' | 'json';
  /** detected header → field mapping, for the preview ("Title ← Song Name") */
  mapping: { column: string; field: string }[];
  skipped: number;
}

type Field = 'title' | 'artist' | 'language' | 'tags' | 'tempo' | 'key' | 'notes';

const HEADER_ALIASES: Record<Field, string[]> = {
  title: ['title', 'song', 'songs', 'song title', 'song name', 'name', 'song_name', 'songtitle'],
  artist: ['artist', 'singer', 'author', 'band', 'writer', 'composer', 'by', 'artists', 'originally by'],
  language: ['language', 'lang', 'languages'],
  tags: ['genre', 'genres', 'category', 'categories', 'tag', 'tags', 'type', 'theme', 'themes', 'style'],
  tempo: ['tempo', 'speed', 'pace', 'beat'],
  key: ['key', 'musical key', 'scale'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'lyrics', 'link', 'url'],
};

const POSITIONAL: Field[] = ['title', 'artist', 'language', 'tags', 'tempo', 'key', 'notes'];

function fieldForHeader(h: string): Field | null {
  const k = h.trim().toLowerCase().replace(/[_\-]+/g, ' ');
  for (const [field, names] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
    if (names.includes(k)) return field;
  }
  return null;
}

/** Minimal RFC-4180 style parser with a configurable delimiter. */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function countDelims(line: string, d: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === d && !quoted) n++;
  }
  return n;
}

function detectDelimiter(lines: string[]): string | null {
  const sample = lines.slice(0, 30);
  if (sample.length === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const d of ['\t', ',', ';', '|']) {
    const counts = sample.map((l) => countDelims(l, d));
    const withDelim = counts.filter((n) => n > 0).length;
    if (withDelim / sample.length < 0.7) continue;
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)]!;
    const consistent = counts.filter((n) => n === mode).length / counts.length;
    const score = consistent * (d === '\t' ? 1.2 : 1);
    if (mode > 0 && consistent >= 0.6 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

const LEADING_JUNK = /^\s*(?:[-*•·▪►>]+|\(?\d{1,3}[.)\]:\-]|#\d+)\s*/;

export function cleanTitle(s: string): string {
  let t = s.trim().replace(LEADING_JUNK, '').trim();
  t = t.replace(/^["“”']+|["“”']+$/g, '').trim();
  return t.replace(/\s+/g, ' ');
}

function splitDash(line: string, mode: DashMode): { title: string; artist: string } {
  const m = mode === 'none' ? null : line.match(/\s[-–—]\s/);
  if (!m || m.index === undefined) return { title: cleanTitle(line), artist: '' };
  const left = cleanTitle(line.slice(0, m.index));
  const right = line.slice(m.index + m[0].length).trim();
  return mode === 'title-artist' ? { title: left, artist: right } : { title: right, artist: left };
}

function emptyRow(): ParsedRow {
  return { title: '', artist: '', language: '', tags: [], tempo: '', key: '', notes: '' };
}

function applyField(row: ParsedRow, field: Field, value: string) {
  const v = value.trim();
  if (!v) return;
  switch (field) {
    case 'title': row.title = cleanTitle(v); break;
    case 'artist': row.artist = v; break;
    case 'language': row.language = normalizeLanguage(v); break;
    case 'tags': row.tags = normalizeTags(v); break;
    case 'tempo': row.tempo = normalizeTempo(v); break;
    case 'key': row.key = v; break;
    case 'notes': row.notes = row.notes ? `${row.notes} ${v}` : v; break;
  }
}

function fromObjects(objs: Record<string, unknown>[]): ParseResult {
  const rows: ParsedRow[] = [];
  const mapping = new Map<string, string>();
  let skipped = 0;
  for (const o of objs) {
    const row = emptyRow();
    for (const [k, v] of Object.entries(o)) {
      const f = fieldForHeader(k);
      if (!f) continue;
      mapping.set(k, f);
      applyField(row, f, Array.isArray(v) ? v.join(', ') : String(v ?? ''));
    }
    if (row.title) rows.push(row);
    else skipped++;
  }
  return { rows, format: 'json', mapping: [...mapping].map(([column, field]) => ({ column, field })), skipped };
}

export function parseSongs(input: string, opts: ParseOptions = { dashMode: 'title-artist' }): ParseResult {
  const text = input.replace(/^﻿/, '').trim();
  if (!text) return { rows: [], format: 'lines', mapping: [], skipped: 0 };

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const data = JSON.parse(text) as unknown;
      let list: unknown[] = [];
      if (Array.isArray(data)) list = data;
      else if (data && typeof data === 'object' && Array.isArray((data as { songs?: unknown }).songs)) {
        list = (data as { songs: unknown[] }).songs;
      }
      if (list.length) {
        if (list.every((x) => typeof x === 'string')) {
          return parseSongs((list as string[]).join('\n'), opts);
        }
        return fromObjects(list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object'));
      }
    } catch {
      /* not JSON after all, fall through to text parsing */
    }
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const delim = opts.forceLines ? null : detectDelimiter(lines);

  if (delim) {
    const table = parseDelimited(text, delim);
    const first = table[0]!.map((c) => c.trim());
    const fields = first.map(fieldForHeader);
    const hasHeader = fields.includes('title');
    const body = hasHeader ? table.slice(1) : table;
    const cols: (Field | null)[] = hasHeader ? fields : first.map((_, i) => POSITIONAL[i] ?? null);
    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (const cells of body) {
      const row = emptyRow();
      cells.forEach((c, i) => {
        const f = cols[i];
        if (f) applyField(row, f, c);
      });
      if (row.title) rows.push(row);
      else skipped++;
    }
    const mapping = cols
      .map((f, i) => (f ? { column: hasHeader ? first[i]! : `Column ${i + 1}`, field: f } : null))
      .filter((x) => x !== null);
    return { rows, format: 'table', mapping, skipped };
  }

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const line of lines) {
    const { title, artist } = splitDash(line, opts.dashMode);
    if (!title) {
      skipped++;
      continue;
    }
    const row = emptyRow();
    row.title = title;
    row.artist = artist;
    rows.push(row);
  }
  return { rows, format: 'lines', mapping: [{ column: 'Each line', field: 'title' }], skipped };
}

export function songKey(title: string, artist = ''): string {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `${norm(title)}|${norm(artist)}`;
}
