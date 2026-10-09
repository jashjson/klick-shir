export interface Season {
  name: string;
  /** tags that make a song a good fit */
  tags: string[];
  blurb: string;
}

/** Anonymous Gregorian algorithm for Western Easter. */
export function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const DAY = 86_400_000;
const at = (d: Date, offset: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);

export function currentSeason(now: Date): Season | null {
  const y = now.getFullYear();
  const today = new Date(y, now.getMonth(), now.getDate()).getTime();
  const easter = easterDate(y);

  // Advent: four Sundays before Dec 25
  const xmas = new Date(y, 11, 25);
  const adventStart = at(xmas, -((xmas.getDay() + 7) % 7 || 7) - 21);
  if (today >= adventStart.getTime() && today < xmas.getTime()) {
    return { name: 'Advent', tags: ['Advent', 'Christmas'], blurb: 'Waiting and expectation' };
  }
  if (today >= xmas.getTime() || today <= new Date(y, 0, 5).getTime()) {
    return { name: 'Christmas', tags: ['Christmas'], blurb: 'Celebrating the birth of Christ' };
  }
  const palm = at(easter, -7).getTime();
  if (today >= palm && today < easter.getTime()) {
    return { name: 'Holy Week', tags: ['Easter', 'Lent', 'Communion', 'Surrender'], blurb: 'The road to the cross' };
  }
  if (today >= at(easter, -46).getTime() && today < palm) {
    return { name: 'Lent', tags: ['Lent', 'Surrender', 'Grace', 'Communion'], blurb: 'Repentance and reflection' };
  }
  if (today >= easter.getTime() && today < at(easter, 49).getTime()) {
    return { name: 'Easter', tags: ['Easter', 'Victory', 'Praise'], blurb: 'He is risen' };
  }
  if (today >= at(easter, 49).getTime() && today < at(easter, 56).getTime()) {
    return { name: 'Pentecost', tags: ['Holy Spirit'], blurb: 'The coming of the Spirit' };
  }
  if (now.getMonth() === 10) {
    return { name: 'Thanksgiving', tags: ['Thanksgiving', 'Praise'], blurb: 'A season of gratitude' };
  }
  return null;
}

/** Whole calendar days from a to b, ignoring time of day (and DST shifts). */
export function daysBetween(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / DAY);
}
