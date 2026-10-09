import { classify, normalizeLanguage, normalizeTags } from './classify';
import { DEFAULT_OPTIONS } from './generate';
import { songKey } from './parse';
import type { GenOptions, HistoryEntry, ParsedRow, PlanItem, Settings, Song } from './types';

export interface AppState {
  songs: Song[];
  history: HistoryEntry[];
  plan: { event: string; date: string; items: PlanItem[]; options: GenOptions };
  settings: Settings;
}

const KEY = 'selah:v1';

export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fresh(): AppState {
  return {
    songs: [],
    history: [],
    plan: { event: '', date: today(), items: [], options: { ...DEFAULT_OPTIONS } },
    settings: { minutesPerSong: 5, showArtist: true, showLanguage: false },
  };
}

function load(): AppState {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<AppState>;
    return {
      songs: Array.isArray(p.songs) ? p.songs : [],
      history: Array.isArray(p.history) ? p.history : [],
      plan: {
        ...base.plan,
        ...p.plan,
        options: { ...DEFAULT_OPTIONS, ...p.plan?.options },
        items: Array.isArray(p.plan?.items) ? p.plan!.items : [],
      },
      settings: { ...base.settings, ...p.settings },
    };
  } catch {
    return base;
  }
}

let state: AppState = fresh();
const listeners = new Set<() => void>();

export function initStore() {
  state = load();
}

export const get = (): AppState => state;

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the app keeps working for this session */
  }
}

/** Mutate state, save, and tell panels to re-render. Pass `silent` for keystroke-level saves. */
export function update(fn: (s: AppState) => void, opts: { silent?: boolean } = {}) {
  fn(state);
  persist();
  if (!opts.silent) listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
}

export const songById = (id: string): Song | undefined => state.songs.find((s) => s.id === id);

export const planSongs = (): Song[] =>
  state.plan.items.map((i) => songById(i.id)).filter((s): s is Song => !!s);

export function languages(): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of state.songs) m.set(s.language || 'Unknown', (m.get(s.language || 'Unknown') ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function allTags(): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of state.songs) for (const t of s.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface ImportOptions {
  autoCategorize: boolean;
  defaultLanguage: string;
  defaultTags: string[];
  onDuplicate: 'skip' | 'update';
}

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
  needReview: number;
}

export function buildSong(row: ParsedRow, opts: Pick<ImportOptions, 'autoCategorize' | 'defaultLanguage' | 'defaultTags'>): Song {
  let language = row.language ? normalizeLanguage(row.language) : '';
  let tags = [...row.tags];
  let tempo = row.tempo;
  let review = false;

  if (opts.autoCategorize) {
    const c = classify(row.title, row.artist);
    if (!language) {
      language = c.language;
      review = c.languageGuessed;
    }
    if (!tags.length) {
      tags = c.tags;
      review = review || tags.length > 0;
    }
    if (!tempo) tempo = c.tempo;
  }
  if (!language) language = normalizeLanguage(opts.defaultLanguage);
  tags = normalizeTags([...tags, ...opts.defaultTags]);

  return {
    id: uid(),
    title: row.title,
    artist: row.artist,
    language,
    tags,
    tempo,
    key: row.key,
    notes: row.notes,
    favorite: false,
    review,
    addedAt: Date.now(),
  };
}

/** Is `a` the same song as `b`? If one side has no artist, titles alone decide. */
function sameSong(a: { title: string; artist: string }, b: { title: string; artist: string }): boolean {
  const [ta, aa] = songKey(a.title, a.artist).split('|');
  const [tb, ab] = songKey(b.title, b.artist).split('|');
  return ta === tb && (!aa || !ab || aa === ab);
}

export function previewDuplicates(rows: ParsedRow[]): number {
  const seen: { title: string; artist: string }[] = [...state.songs];
  let dupes = 0;
  for (const r of rows) {
    if (seen.some((s) => sameSong(s, r))) dupes++;
    else seen.push(r);
  }
  return dupes;
}

export function importRows(rows: ParsedRow[], opts: ImportOptions): ImportSummary {
  const sum: ImportSummary = { added: 0, updated: 0, skipped: 0, needReview: 0 };
  update((s) => {
    for (const row of rows) {
      const existing = s.songs.find((x) => sameSong(x, row));
      if (existing) {
        if (opts.onDuplicate === 'update') {
          const built = buildSong(row, opts);
          existing.artist = existing.artist || built.artist;
          existing.language = built.language || existing.language;
          existing.tags = normalizeTags([...existing.tags, ...built.tags]);
          existing.tempo = built.tempo || existing.tempo;
          existing.key = built.key || existing.key;
          existing.notes = existing.notes || built.notes;
          sum.updated++;
        } else sum.skipped++;
        continue;
      }
      const song = buildSong(row, opts);
      if (song.review) sum.needReview++;
      s.songs.push(song);
      sum.added++;
    }
  });
  return sum;
}

/** Re-run auto-categorisation on songs that are missing language, tags or tempo. */
export function autoCategorize(ids?: string[]): number {
  let n = 0;
  update((s) => {
    for (const song of s.songs) {
      if (ids && !ids.includes(song.id)) continue;
      const c = classify(song.title, song.artist);
      let changed = false;
      if (!song.language) { song.language = c.language; song.review = song.review || c.languageGuessed; changed = true; }
      if (!song.tags.length && c.tags.length) { song.tags = c.tags; song.review = true; changed = true; }
      if (!song.tempo) { song.tempo = c.tempo; changed = true; }
      if (changed) n++;
    }
  });
  return n;
}

export function removeSongs(ids: string[]) {
  const set = new Set(ids);
  update((s) => {
    s.songs = s.songs.filter((x) => !set.has(x.id));
    s.plan.items = s.plan.items.filter((i) => !set.has(i.id));
  });
}

export function saveSetToHistory(): HistoryEntry | null {
  const songs = planSongs();
  if (!songs.length) return null;
  const entry: HistoryEntry = {
    id: uid(),
    date: state.plan.date || today(),
    event: state.plan.event.trim(),
    songIds: songs.map((s) => s.id),
    snapshot: songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist, language: s.language })),
  };
  update((s) => s.history.unshift(entry));
  return entry;
}

export function exportBackup(): string {
  return JSON.stringify({ app: 'selah', version: 1, songs: state.songs, history: state.history }, null, 2);
}

export function restoreBackup(text: string): { songs: number; history: number } | null {
  try {
    const d = JSON.parse(text) as { app?: string; songs?: Song[]; history?: HistoryEntry[] };
    if (d.app !== 'selah' || !Array.isArray(d.songs)) return null;
    update((s) => {
      s.songs = d.songs!;
      s.history = Array.isArray(d.history) ? d.history : [];
      s.plan.items = [];
    });
    return { songs: d.songs.length, history: state.history.length };
  } catch {
    return null;
  }
}
