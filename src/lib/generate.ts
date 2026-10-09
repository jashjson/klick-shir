import type { GenOptions, HistoryEntry, Song, Tempo } from './types';
import { daysBetween } from './seasons';

export const DEFAULT_OPTIONS: GenOptions = {
  count: 5,
  languages: [],
  tags: [],
  tagMode: 'any',
  excludeTags: [],
  tempos: [],
  balanceLanguages: true,
  flow: 'arc',
  avoidRecentSets: 2,
  preferFresh: true,
  maxPerArtist: 2,
  favoritesOnly: false,
};

export interface GenResult {
  songs: Song[];
  notes: string[];
}

export type Rng = () => number;

const lc = (s: string) => s.toLowerCase();

export function matchesFilters(song: Song, o: GenOptions): boolean {
  if (o.favoritesOnly && !song.favorite) return false;
  if (o.languages.length && !o.languages.includes(song.language)) return false;
  if (o.tempos.length && !o.tempos.includes(song.tempo)) return false;
  const tags = song.tags.map(lc);
  if (o.excludeTags.some((t) => tags.includes(lc(t)))) return false;
  if (o.tags.length) {
    const want = o.tags.map(lc);
    const ok = o.tagMode === 'all' ? want.every((t) => tags.includes(t)) : want.some((t) => tags.includes(t));
    if (!ok) return false;
  }
  return true;
}

/** songId -> most recent date it was sung */
export function lastUsedMap(history: HistoryEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of history) {
    for (const id of h.songIds) {
      const prev = m.get(id);
      if (!prev || h.date > prev) m.set(id, h.date);
    }
  }
  return m;
}

export function daysSince(dateStr: string | undefined, now: Date): number {
  if (!dateStr) return Infinity;
  const [y, mo, d] = dateStr.split('-').map(Number);
  return Math.max(0, daysBetween(new Date(y!, (mo ?? 1) - 1, d ?? 1), now));
}

function freshness(song: Song, last: Map<string, string>, now: Date): number {
  const d = daysSince(last.get(song.id), now);
  if (d === Infinity) return 1.5;
  return Math.min(1.2, 0.3 + d / 60);
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: Rng): T {
  let total = 0;
  const ws = items.map((i) => {
    const w = Math.max(0.0001, weight(i));
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const TEMPO_RANK: Record<Tempo, number> = { fast: 0, medium: 1, '': 1, slow: 2 };

export function orderSet(songs: Song[], flow: GenOptions['flow'], rng: Rng = Math.random): Song[] {
  const shuffled = shuffle(songs, rng);
  if (flow === 'random') return shuffled;
  return shuffled.sort((a, b) => TEMPO_RANK[a.tempo] - TEMPO_RANK[b.tempo]);
}

export function generateSet(input: {
  songs: Song[];
  history: HistoryEntry[];
  locked?: Song[];
  options: GenOptions;
  now?: Date;
  rng?: Rng;
}): GenResult {
  const { songs, history, options: o } = input;
  const locked = input.locked ?? [];
  const now = input.now ?? new Date();
  const rng = input.rng ?? Math.random;
  const notes: string[] = [];

  const need = Math.max(0, o.count - locked.length);
  const lockedIds = new Set(locked.map((s) => s.id));
  const eligible = songs.filter((s) => !lockedIds.has(s.id) && matchesFilters(s, o));
  const last = lastUsedMap(history);

  let pool = eligible;
  if (o.avoidRecentSets > 0 && history.length) {
    const recent = new Set(
      [...history].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, o.avoidRecentSets).flatMap((h) => h.songIds),
    );
    const fresh = eligible.filter((s) => !recent.has(s.id));
    if (fresh.length >= need) pool = fresh;
    else {
      const stale = eligible
        .filter((s) => recent.has(s.id))
        .sort((a, b) => (last.get(a.id) ?? '') .localeCompare(last.get(b.id) ?? ''));
      pool = [...fresh, ...stale.slice(0, need - fresh.length)];
      if (eligible.length >= need) {
        notes.push(`Only ${fresh.length} matching songs were free of recent services, so ${need - fresh.length} repeat(s) were allowed.`);
      }
    }
  }

  if (pool.length < need) {
    notes.push(
      pool.length === 0
        ? 'No songs match these filters. Try relaxing them.'
        : `Only ${pool.length + locked.length} song${pool.length + locked.length === 1 ? '' : 's'} match these filters (you asked for ${o.count}).`,
    );
  }

  const chosen: Song[] = [...locked];
  const remaining = new Set(pool);
  const artistCount = new Map<string, number>();
  const langCount = new Map<string, number>();
  const bump = (s: Song) => {
    if (s.artist) artistCount.set(lc(s.artist), (artistCount.get(lc(s.artist)) ?? 0) + 1);
    langCount.set(s.language, (langCount.get(s.language) ?? 0) + 1);
  };
  locked.forEach(bump);

  let capRelaxed = false;
  while (chosen.length < o.count && remaining.size) {
    let cands = [...remaining];
    if (o.maxPerArtist > 0) {
      const capped = cands.filter((s) => !s.artist || (artistCount.get(lc(s.artist)) ?? 0) < o.maxPerArtist);
      if (capped.length) cands = capped;
      else capRelaxed = true;
    }
    if (o.balanceLanguages) {
      const langs = [...new Set(cands.map((s) => s.language))];
      if (langs.length > 1) {
        const min = Math.min(...langs.map((l) => langCount.get(l) ?? 0));
        const lows = langs.filter((l) => (langCount.get(l) ?? 0) === min);
        const lang = lows[Math.floor(rng() * lows.length)]!;
        cands = cands.filter((s) => s.language === lang);
      }
    }
    const pick = weightedPick(
      cands,
      (s) => (s.favorite ? 2 : 1) * (o.preferFresh ? freshness(s, last, now) : 1),
      rng,
    );
    remaining.delete(pick);
    chosen.push(pick);
    bump(pick);
  }
  if (capRelaxed) notes.push(`Not enough variety to keep to ${o.maxPerArtist} per artist, so the cap was relaxed.`);

  return { songs: orderSet(chosen, o.flow, rng), notes };
}

/** Pick one replacement for a slot, respecting filters and avoiding what's already in the set. */
export function rerollOne(input: {
  songs: Song[];
  history: HistoryEntry[];
  current: Song[];
  replacing: Song;
  options: GenOptions;
  now?: Date;
  rng?: Rng;
}): Song | null {
  const { songs, history, current, replacing, options } = input;
  const rng = input.rng ?? Math.random;
  const now = input.now ?? new Date();
  const inSet = new Set(current.map((s) => s.id));
  const last = lastUsedMap(history);
  let pool = songs.filter((s) => !inSet.has(s.id) && matchesFilters(s, options));
  // keep the slot's feel: prefer the same tempo, then same language
  const sameTempo = pool.filter((s) => s.tempo === replacing.tempo);
  if (sameTempo.length) pool = sameTempo;
  if (options.balanceLanguages) {
    const sameLang = pool.filter((s) => s.language === replacing.language);
    if (sameLang.length) pool = sameLang;
  }
  if (options.avoidRecentSets > 0) {
    const recent = new Set(
      [...history].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, options.avoidRecentSets).flatMap((h) => h.songIds),
    );
    const fresh = pool.filter((s) => !recent.has(s.id));
    if (fresh.length) pool = fresh;
  }
  if (!pool.length) return null;
  return weightedPick(pool, (s) => (s.favorite ? 2 : 1) * freshness(s, last, now), rng);
}
