import { daysSince, lastUsedMap, shuffle } from './generate';
import { currentSeason } from './seasons';
import type { HistoryEntry, Song } from './types';

export interface Suggestion {
  song: Song;
  reason: string;
}

export interface SuggestionGroup {
  id: 'pairs' | 'gaps' | 'fresh' | 'season' | 'theme';
  title: string;
  hint: string;
  items: Suggestion[];
}

/** Quick theme chips → keywords searched in title / tags / notes. */
export const THEMES: Record<string, string[]> = {
  Grace: ['grace', 'mercy', 'forgive', 'redeem', 'saved', 'salvation', 'rescued', 'amazing'],
  Healing: ['heal', 'comfort', 'restore', 'pray', 'peace', 'rest', 'refuge', 'shelter'],
  Thanksgiving: ['thank', 'grateful', 'goodness', 'blessing', 'blessed', 'praise'],
  Victory: ['victory', 'triumph', 'overcome', 'warrior', 'battle', 'conquer', 'stronger'],
  Faith: ['faith', 'trust', 'believe', 'hope', 'promise', 'faithful', 'anchor'],
  Surrender: ['surrender', 'offering', 'take my life', 'all to jesus', 'consecrat', 'here i am'],
  Love: ['love', 'loved', 'beloved', 'kindness'],
  'Holy Spirit': ['spirit', 'fire', 'breath', 'wind', 'pentecost'],
  Cross: ['cross', 'blood', 'calvary', 'lamb', 'risen', 'resurrection'],
  Mission: ['go', 'send', 'nations', 'light', 'harvest', 'witness', 'mission'],
  Unity: ['together', 'unity', 'one', 'family', 'fellowship', 'body'],
  Joy: ['joy', 'rejoice', 'celebrate', 'dance', 'glad'],
};

function pickN<T>(items: T[], n: number): T[] {
  return shuffle(items).slice(0, n);
}

function sharedTags(a: Song, b: Song): string[] {
  const set = new Set(b.tags.map((t) => t.toLowerCase()));
  return a.tags.filter((t) => set.has(t.toLowerCase()));
}

function describeAge(days: number): string {
  if (days === Infinity) return 'Never sung in a saved set';
  if (days < 14) return `Sung ${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 60) return `Last sung ${Math.round(days / 7)} weeks ago`;
  return `Last sung ${Math.round(days / 30)} months ago`;
}

export function themeSearch(songs: Song[], query: string, exclude: Set<string>): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const keywords = new Set<string>([q]);
  for (const [name, words] of Object.entries(THEMES)) {
    if (name.toLowerCase() === q) words.forEach((w) => keywords.add(w));
  }
  const scored: { song: Song; score: number; hit: string }[] = [];
  for (const song of songs) {
    if (exclude.has(song.id)) continue;
    const title = song.title.toLowerCase();
    const tags = song.tags.join(' ').toLowerCase();
    const notes = `${song.notes} ${song.artist}`.toLowerCase();
    let score = 0;
    let hit = '';
    for (const k of keywords) {
      if (title.includes(k)) { score += 3; hit ||= `title mentions “${k}”`; }
      if (tags.includes(k)) { score += 3; hit ||= `tagged ${song.tags.find((t) => t.toLowerCase().includes(k)) ?? k}`; }
      if (notes.includes(k)) { score += 1; hit ||= `notes mention “${k}”`; }
    }
    if (score) scored.push({ song, score: score + (song.favorite ? 0.5 : 0), hit });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ song, hit }) => ({ song, reason: hit.charAt(0).toUpperCase() + hit.slice(1) }));
}

export function buildSuggestions(ctx: {
  songs: Song[];
  set: Song[];
  history: HistoryEntry[];
  now?: Date;
  theme?: string;
}): SuggestionGroup[] {
  const { songs, set, history } = ctx;
  const now = ctx.now ?? new Date();
  const inSet = new Set(set.map((s) => s.id));
  const available = songs.filter((s) => !inSet.has(s.id));
  const last = lastUsedMap(history);
  const groups: SuggestionGroup[] = [];

  if (ctx.theme?.trim()) {
    groups.push({
      id: 'theme',
      title: `Songs about “${ctx.theme.trim()}”`,
      hint: 'Matched on titles, tags and notes',
      items: themeSearch(songs, ctx.theme, inSet),
    });
  }

  // 1. pairs well with the current set
  if (set.length) {
    const hasTempo = new Set(set.map((s) => s.tempo));
    const scored = available.map((c) => {
      let score = 0;
      const why: string[] = [];
      let tagHits = new Set<string>();
      for (const s of set) {
        const sh = sharedTags(c, s);
        sh.forEach((t) => tagHits.add(t));
        score += sh.length * 2;
        if (c.artist && c.artist.toLowerCase() === s.artist.toLowerCase()) {
          score += 1.5;
          if (!why.some((w) => w.startsWith('Same artist'))) why.push(`Same artist (${c.artist})`);
        }
        if (c.language === s.language) score += 0.5;
      }
      score /= set.length;
      if (tagHits.size) why.unshift(`Shares ${[...tagHits].slice(0, 2).join(' & ')}`);
      if (c.tempo === 'slow' && !hasTempo.has('slow')) { score += 2; why.push('adds a slow moment'); }
      if (c.tempo === 'fast' && !hasTempo.has('fast')) { score += 2; why.push('adds energy'); }
      const d = daysSince(last.get(c.id), now);
      if (d < 14) score -= 2;
      if (c.favorite) score += 0.5;
      score += Math.random() * 0.5;
      return { song: c, score, reason: why.length ? why.join(' · ') : 'Similar feel' };
    });
    const items = scored.filter((x) => x.score > 0.4).sort((a, b) => b.score - a.score).slice(0, 5);
    if (items.length) groups.push({ id: 'pairs', title: 'Goes well with this set', hint: 'Shared themes, artists and tempo balance', items });
  }

  // 2. gaps: languages and tempo missing from the set
  if (set.length) {
    const items: Suggestion[] = [];
    const langsInLibrary = [...new Set(songs.map((s) => s.language).filter(Boolean))];
    const langsInSet = new Set(set.map((s) => s.language));
    if (langsInLibrary.length > 1) {
      for (const lang of langsInLibrary.filter((l) => !langsInSet.has(l))) {
        const c = pickN(available.filter((s) => s.language === lang), 1)[0];
        if (c) items.push({ song: c, reason: `No ${lang} song in this set yet` });
      }
    }
    const tempos = new Set(set.map((s) => s.tempo));
    if (set.length >= 3) {
      if (!tempos.has('slow')) {
        const c = pickN(available.filter((s) => s.tempo === 'slow'), 1)[0];
        if (c) items.push({ song: c, reason: 'Nothing slow yet: a quiet moment to close' });
      }
      if (!tempos.has('fast')) {
        const c = pickN(available.filter((s) => s.tempo === 'fast'), 1)[0];
        if (c) items.push({ song: c, reason: 'Nothing upbeat yet: an energetic opener' });
      }
    }
    if (items.length) groups.push({ id: 'gaps', title: 'Balance the set', hint: 'Fills in what the set is missing', items: items.slice(0, 5) });
  }

  // 3. haven't sung in a while
  const stale = available
    .map((s) => ({ s, d: daysSince(last.get(s.id), now) }))
    .filter((x) => x.d >= 45)
    .sort((a, b) => b.d - a.d)
    .slice(0, 15);
  if (stale.length) {
    groups.push({
      id: 'fresh',
      title: 'Not sung in a while',
      hint: history.length ? 'Bring back forgotten favourites' : 'Everything is fresh until you start saving sets',
      items: pickN(stale, 5).map(({ s, d }) => ({ song: s, reason: describeAge(d) })),
    });
  }

  // 4. liturgical season
  const season = currentSeason(now);
  if (season) {
    const want = season.tags.map((t) => t.toLowerCase());
    const hits = available.filter((s) => s.tags.some((t) => want.includes(t.toLowerCase())));
    if (hits.length) {
      groups.push({
        id: 'season',
        title: `For ${season.name}`,
        hint: season.blurb,
        items: pickN(hits, 5).map((s) => ({ song: s, reason: `Tagged ${s.tags.find((t) => want.includes(t.toLowerCase()))}` })),
      });
    }
  }

  return groups;
}
