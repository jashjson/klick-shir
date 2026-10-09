export type Tempo = 'fast' | 'medium' | 'slow' | '';

export interface Song {
  id: string;
  title: string;
  artist: string;
  language: string;
  tags: string[];
  tempo: Tempo;
  key: string;
  notes: string;
  favorite: boolean;
  /** true when language/tags were guessed and haven't been confirmed by a person */
  review: boolean;
  addedAt: number;
}

export interface SetSnapshotItem {
  id: string;
  title: string;
  artist: string;
  language: string;
}

export interface HistoryEntry {
  id: string;
  date: string; // YYYY-MM-DD
  event: string;
  songIds: string[];
  /** kept so history survives deleting a song from the library */
  snapshot: SetSnapshotItem[];
}

export interface GenOptions {
  count: number;
  languages: string[];
  tags: string[];
  tagMode: 'any' | 'all';
  excludeTags: string[];
  tempos: Tempo[];
  balanceLanguages: boolean;
  flow: 'random' | 'arc';
  avoidRecentSets: number;
  preferFresh: boolean;
  /** 0 = unlimited */
  maxPerArtist: number;
  favoritesOnly: boolean;
}

export interface PlanItem {
  id: string;
  locked: boolean;
}

export interface Settings {
  minutesPerSong: number;
  showArtist: boolean;
  showLanguage: boolean;
}

export interface ParsedRow {
  title: string;
  artist: string;
  language: string;
  tags: string[];
  tempo: Tempo;
  key: string;
  notes: string;
}
