import { describe, expect, it } from 'vitest';
import { classify, detectLanguage, normalizeTempo } from '../src/lib/classify';
import { parseSongs } from '../src/lib/parse';
import { DEFAULT_OPTIONS, generateSet, rerollOne } from '../src/lib/generate';
import { buildSuggestions, themeSearch } from '../src/lib/suggest';
import { currentSeason, easterDate } from '../src/lib/seasons';
import { daysSince } from '../src/lib/generate';
import { decodeSet, encodeSet, formatSetText } from '../src/lib/share';
import { SAMPLE_CSV } from '../src/lib/sample';
import type { HistoryEntry, Song } from '../src/lib/types';

let n = 0;
const song = (o: Partial<Song>): Song => ({
  id: `s${++n}`, title: `Song ${n}`, artist: '', language: 'English', tags: [], tempo: 'medium',
  key: '', notes: '', favorite: false, review: false, addedAt: 0, ...o,
});

function seeded(seed = 7) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('language detection', () => {
  it('detects scripts', () => {
    expect(detectLanguage('யேசுவே என் இரட்சகர்').language).toBe('Tamil');
    expect(detectLanguage('യേശു എന്റെ രക്ഷകൻ').language).toBe('Malayalam');
    expect(detectLanguage('यीशु मेरा सहारा').language).toBe('Hindi');
    expect(detectLanguage('예수 사랑').language).toBe('Korean');
  });
  it('defaults to English and flags hint-based guesses', () => {
    expect(detectLanguage('Amazing Grace')).toEqual({ language: 'English', guessed: false });
    expect(detectLanguage('Noche de Paz')).toEqual({ language: 'Spanish', guessed: true });
    expect(detectLanguage('Yeshu Mera Sahara').language).toBe('Hindi');
  });
  it('does not match hint words inside longer words', () => {
    expect(detectLanguage('Devastating Love').language).toBe('English');
  });
});

describe('classification', () => {
  it('guesses tags and tempo', () => {
    const c = classify('Christmas Joy to the World');
    expect(c.tags).toContain('Christmas');
    expect(c.tempo).toBe('fast');
    expect(classify('Holy Holy Holy').tempo).toBe('slow');
  });
  it('normalises tempo words', () => {
    expect(normalizeTempo('Upbeat')).toBe('fast');
    expect(normalizeTempo('Ballad')).toBe('slow');
    expect(normalizeTempo('mid')).toBe('medium');
  });
});

describe('parsing', () => {
  it('parses CSV with header aliases and quotes', () => {
    const r = parseSongs('Song Name,Singer,Lang,Genre\n"Holy, Holy, Holy",Heber,en,"Hymn, Worship"');
    expect(r.rows[0]).toMatchObject({ title: 'Holy, Holy, Holy', artist: 'Heber', language: 'English', tags: ['Hymn', 'Worship'] });
  });
  it('parses the bundled sample', () => {
    const r = parseSongs(SAMPLE_CSV);
    expect(r.rows.length).toBeGreaterThan(40);
    expect(r.skipped).toBe(0);
    expect(r.rows.find((x) => x.title === '10,000 Reasons')?.artist).toBe('Matt Redman');
    expect(new Set(r.rows.map((x) => x.language))).toEqual(new Set(['English', 'Spanish']));
  });
  it('parses numbered plain lists and splits Title - Artist', () => {
    const r = parseSongs('1. Amazing Grace - John Newton\n2) Oceans\n• How Great Thou Art');
    expect(r.rows.map((x) => x.title)).toEqual(['Amazing Grace', 'Oceans', 'How Great Thou Art']);
    expect(r.rows[0]!.artist).toBe('John Newton');
  });
  it('supports artist-first and no-split modes', () => {
    expect(parseSongs('Hillsong - Oceans', { dashMode: 'artist-title' }).rows[0]).toMatchObject({ title: 'Oceans', artist: 'Hillsong' });
    expect(parseSongs('Hillsong - Oceans', { dashMode: 'none' }).rows[0]!.title).toBe('Hillsong - Oceans');
  });
  it('forceLines keeps commas in titles', () => {
    const r = parseSongs('Holy, Holy, Holy\nCome, Thou Fount\nBe Thou My Vision', { dashMode: 'none', forceLines: true });
    expect(r.rows.map((x) => x.title)).toEqual(['Holy, Holy, Holy', 'Come, Thou Fount', 'Be Thou My Vision']);
  });
  it('parses JSON arrays of strings and objects', () => {
    expect(parseSongs('["A","B"]').rows).toHaveLength(2);
    expect(parseSongs('[{"title":"A","genre":"Hymn"}]').rows[0]!.tags).toEqual(['Hymn']);
  });
  it('handles tab separated paste from a spreadsheet', () => {
    const r = parseSongs('Title\tLanguage\nOceans\tEnglish\nNoche de Paz\tSpanish');
    expect(r.rows[1]).toMatchObject({ title: 'Noche de Paz', language: 'Spanish' });
  });
});

describe('generation', () => {
  const lib = [
    ...Array.from({ length: 10 }, () => song({ language: 'English', tempo: 'fast' })),
    ...Array.from({ length: 10 }, () => song({ language: 'Hindi', tempo: 'slow' })),
    ...Array.from({ length: 10 }, () => song({ language: 'Tamil', tempo: 'medium' })),
  ];

  it('returns the requested number with no duplicates', () => {
    const r = generateSet({ songs: lib, history: [], options: { ...DEFAULT_OPTIONS, count: 12 }, rng: seeded() });
    expect(r.songs).toHaveLength(12);
    expect(new Set(r.songs.map((s) => s.id)).size).toBe(12);
  });
  it('balances languages', () => {
    const r = generateSet({ songs: lib, history: [], options: { ...DEFAULT_OPTIONS, count: 6 }, rng: seeded(3) });
    const by = (l: string) => r.songs.filter((s) => s.language === l).length;
    expect([by('English'), by('Hindi'), by('Tamil')]).toEqual([2, 2, 2]);
  });
  it('orders fast → slow in arc mode', () => {
    const r = generateSet({ songs: lib, history: [], options: { ...DEFAULT_OPTIONS, count: 9 }, rng: seeded(5) });
    const rank = { fast: 0, medium: 1, slow: 2, '': 1 } as const;
    const ranks = r.songs.map((s) => rank[s.tempo]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it('keeps locked songs and fills the rest', () => {
    const keep = lib[0]!;
    const r = generateSet({ songs: lib, history: [], locked: [keep], options: { ...DEFAULT_OPTIONS, count: 4 }, rng: seeded() });
    expect(r.songs).toHaveLength(4);
    expect(r.songs.some((s) => s.id === keep.id)).toBe(true);
  });
  it('filters by language, tag and exclusions', () => {
    const tagged = [song({ tags: ['Hymn'] }), song({ tags: ['Hymn', 'Christmas'] }), song({ tags: ['Praise'] })];
    const r = generateSet({ songs: tagged, history: [], options: { ...DEFAULT_OPTIONS, count: 3, tags: ['hymn'], excludeTags: ['Christmas'] } });
    expect(r.songs).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/Only 1 song/);
  });
  it('avoids songs from recent services when there are enough others', () => {
    const history: HistoryEntry[] = [{ id: 'h', date: '2026-10-01', event: '', songIds: lib.slice(0, 20).map((s) => s.id), snapshot: [] }];
    const r = generateSet({ songs: lib, history, options: { ...DEFAULT_OPTIONS, count: 5 }, now: new Date(2026, 9, 8), rng: seeded(9) });
    const used = new Set(history[0]!.songIds);
    expect(r.songs.every((s) => !used.has(s.id))).toBe(true);
  });
  it('allows repeats with a note when the library is too small', () => {
    const small = lib.slice(0, 6);
    const history: HistoryEntry[] = [{ id: 'h', date: '2026-10-01', event: '', songIds: small.map((s) => s.id), snapshot: [] }];
    const r = generateSet({ songs: small, history, options: { ...DEFAULT_OPTIONS, count: 4 }, now: new Date(2026, 9, 8) });
    expect(r.songs).toHaveLength(4);
    expect(r.notes.join(' ')).toMatch(/repeat/);
  });
  it('respects max per artist', () => {
    const songs = [...Array.from({ length: 8 }, () => song({ artist: 'Hillsong' })), ...Array.from({ length: 4 }, (_, i) => song({ artist: `Other ${i}` }))];
    const r = generateSet({ songs, history: [], options: { ...DEFAULT_OPTIONS, count: 6, maxPerArtist: 2 }, rng: seeded(2) });
    expect(r.songs.filter((s) => s.artist === 'Hillsong').length).toBeLessThanOrEqual(2);
  });
  it('rerolls a single slot to a song not already in the set', () => {
    const current = lib.slice(0, 3);
    const pick = rerollOne({ songs: lib, history: [], current, replacing: current[0]!, options: DEFAULT_OPTIONS });
    expect(pick).not.toBeNull();
    expect(current.some((s) => s.id === pick!.id)).toBe(false);
  });
});

describe('suggestions', () => {
  it('suggests songs sharing tags and fills tempo gaps', () => {
    const a = song({ tags: ['Worship'], tempo: 'fast', title: 'A' });
    const b = song({ tags: ['Worship'], tempo: 'slow', title: 'B' });
    const c = song({ tags: ['Kids'], tempo: 'fast', title: 'C' });
    const groups = buildSuggestions({ songs: [a, b, c], set: [a], history: [], now: new Date(2026, 5, 10) });
    const pairs = groups.find((g) => g.id === 'pairs')!;
    expect(pairs.items[0]!.song.id).toBe(b.id);
    expect(pairs.items[0]!.reason).toMatch(/Worship/);
  });
  it('flags songs not sung in a long time', () => {
    const a = song({});
    const history: HistoryEntry[] = [{ id: 'h', date: '2026-01-01', event: '', songIds: [a.id], snapshot: [] }];
    const g = buildSuggestions({ songs: [a], set: [], history, now: new Date(2026, 9, 1) }).find((x) => x.id === 'fresh')!;
    expect(g.items[0]!.reason).toMatch(/months ago/);
  });
  it('theme search expands synonyms', () => {
    const r = themeSearch([song({ title: 'Amazing Grace' }), song({ title: 'Mercy Me' }), song({ title: 'Unrelated' })], 'Grace', new Set());
    expect(r.map((x) => x.song.title)).toEqual(expect.arrayContaining(['Amazing Grace', 'Mercy Me']));
    expect(r).toHaveLength(2);
  });
});

describe('seasons', () => {
  it('computes Easter', () => {
    expect(easterDate(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(easterDate(2027).toDateString()).toBe(new Date(2027, 2, 28).toDateString());
  });
  it('maps dates to seasons', () => {
    expect(currentSeason(new Date(2026, 11, 25))?.name).toBe('Christmas');
    expect(currentSeason(new Date(2026, 11, 6))?.name).toBe('Advent');
    expect(currentSeason(new Date(2026, 2, 20))?.name).toBe('Lent');
    expect(currentSeason(new Date(2026, 3, 3))?.name).toBe('Holy Week');
    expect(currentSeason(new Date(2026, 3, 20))?.name).toBe('Easter');
    expect(currentSeason(new Date(2026, 7, 10))).toBeNull();
  });
});

describe('day counting', () => {
  it('ignores time of day', () => {
    expect(daysSince('2026-10-09', new Date(2026, 9, 9, 23, 30))).toBe(0);
    expect(daysSince('2026-10-08', new Date(2026, 9, 9, 0, 5))).toBe(1);
    expect(daysSince(undefined, new Date())).toBe(Infinity);
  });
});

describe('sharing', () => {
  it('round-trips a set through a link, including non-latin text', () => {
    const songs = [song({ title: 'യേശു എന്റെ', artist: 'ആരോ', language: 'Malayalam' }), song({ title: 'Oceans' })];
    const out = decodeSet(encodeSet(songs, 'Sunday Service', '2026-10-11'))!;
    expect(out.event).toBe('Sunday Service');
    expect(out.songs[0]).toEqual({ title: 'യേശു എന്റെ', artist: 'ആരോ', language: 'Malayalam' });
  });
  it('rejects garbage', () => expect(decodeSet('%%%')).toBeNull());
  it('formats text for messaging', () => {
    const txt = formatSetText([song({ title: 'Oceans', artist: 'Hillsong' })], { title: 'Youth Night', showArtist: true, showLanguage: false });
    expect(txt).toContain('1. Oceans (Hillsong)');
  });
});
