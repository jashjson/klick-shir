import type { Tempo } from './types';

export interface Classification {
  language: string;
  /** language came from a keyword hint rather than an unambiguous script / plain English */
  languageGuessed: boolean;
  tags: string[];
  tempo: Tempo;
}

const SCRIPTS: [string, RegExp][] = [
  ['Hindi', /[ऀ-ॿ]/g],
  ['Bengali', /[ঀ-৿]/g],
  ['Punjabi', /[਀-੿]/g],
  ['Gujarati', /[઀-૿]/g],
  ['Odia', /[଀-୿]/g],
  ['Tamil', /[஀-௿]/g],
  ['Telugu', /[ఀ-౿]/g],
  ['Kannada', /[ಀ-೿]/g],
  ['Malayalam', /[ഀ-ൿ]/g],
  ['Sinhala', /[඀-෿]/g],
  ['Thai', /[฀-๿]/g],
  ['Arabic', /[؀-ۿ]/g],
  ['Hebrew', /[֐-׿]/g],
  ['Korean', /[가-힯ᄀ-ᇿ]/g],
  ['Japanese', /[぀-ヿ]/g],
  ['Chinese', /[一-鿿]/g],
  ['Russian', /[Ѐ-ӿ]/g],
  ['Greek', /[Ͱ-Ͽ]/g],
];

/** Romanised words that strongly hint at a language. Deliberately conservative. */
const WORD_HINTS: Record<string, string[]> = {
  Hindi: ['yeshu', 'yesu masih', 'masih', 'prabhu', 'stuti', 'mahima', 'hallelujah prabhu', 'tera', 'mera', 'tu hi', 'tumhari', 'khush', 'dhanyavad', 'pita'],
  Spanish: ['cristo', 'señor', 'senor', 'gloria a', 'santo', 'aleluya', 'noche de', 'grande es', 'dios', 'jesús', 'jesus es', 'cuán', 'cuan', 'amor', 'mi', 'tu'],
  Portuguese: ['senhor', 'louvor', 'aleluia', 'jesus é', 'obrigado', 'glória'],
  French: ['seigneur', 'louange', 'jésus', 'gloire', 'dieu', 'béni'],
  Tamil: ['yesuve', 'yesappa', 'devane', 'thuthi', 'nandri', 'appa', 'karthave', 'aandavar'],
  Telugu: ['yesayya', 'deva', 'stotram', 'prabhuva', 'yehova'],
  Malayalam: ['yeshuve', 'sthuthi', 'nanni', 'daivame', 'karthave', 'yahovaye'],
  Swahili: ['bwana', 'mungu', 'asante', 'sifa', 'yesu ni', 'tumsifu'],
};

export function detectLanguage(text: string): { language: string; guessed: boolean } {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return { language: '', guessed: false };

  let best = '';
  let bestCount = 0;
  for (const [name, re] of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  if (best && bestCount >= letters.length * 0.4) {
    // Devanagari is shared by Hindi, Marathi, Nepali… we can't tell, so flag it.
    return { language: best, guessed: best === 'Hindi' || best === 'Chinese' || best === 'Arabic' };
  }

  const padded = ` ${text.toLowerCase().replace(/[^\p{L}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  let hintLang = '';
  let hintScore = 0;
  for (const [lang, words] of Object.entries(WORD_HINTS)) {
    let score = 0;
    for (const w of words) {
      if (padded.includes(` ${w.trim()} `)) score += w.length > 4 ? 2 : 1;
    }
    if (score > hintScore) {
      hintScore = score;
      hintLang = lang;
    }
  }
  if (/[ñ¿¡]/i.test(text)) return { language: 'Spanish', guessed: true };
  if (/[ãõç]/i.test(text) && hintLang !== 'French') return { language: 'Portuguese', guessed: true };
  if (hintScore >= 2) return { language: hintLang, guessed: true };

  return { language: 'English', guessed: false };
}

const TAG_RULES: [string, RegExp][] = [
  ['Christmas', /\b(christmas|noel|bethlehem|manger|nativity|silent night|joy to the world|o come,? all|first noel|little town|away in a|angels we|hark|born (is|the) king)\b/i],
  ['Advent', /\b(advent|o come,? o come|come,? thou long|emmanuel)\b/i],
  ['Easter', /\b(easter|resurrect\w*|risen|rugged cross|calvary|empty tomb|lamb of god|blood|the cross|he lives|alive|christ the lord is risen)\b/i],
  ['Lent', /\b(lent|repent\w*|create in me|forgive me|search me|cleanse)\b/i],
  ['Communion', /\b(communion|the table|bread|wine|remembrance|broken for|lord'?s supper|in remembrance)\b/i],
  ['Thanksgiving', /\b(thank\w*|grateful|goodness|blessings?|count your)\b/i],
  ['Worship', /\b(worship|holy|glory|bow\b|bow down|adore|majesty|reign|king of kings|lord of all|revelation song|great (is|are)|how great|magnify|exalt)\b/i],
  ['Praise', /\b(praise|hallelujah|alleluia|hosanna|rejoice|celebrat\w*|dance|shout|clap|joy|jubilee|sing)\b/i],
  ['Grace', /\b(grace|mercy|saved|redeem\w*|forgiv\w*|salvation|rescued|ransom\w*|wretch)\b/i],
  ['Faith', /\b(trust|faith|believe|hope|anchor|promise|faithful|still|steadfast|firm foundation)\b/i],
  ['Healing', /\b(heal\w*|pray\w*|comfort|peace|rest|refuge|restore\w*|shelter|strength)\b/i],
  ['Surrender', /\b(surrender\w*|all to jesus|take my life|consecrat\w*|offering|here i am|i give)\b/i],
  ['Holy Spirit', /\b(spirit|pentecost|fire fall|come holy|breath of god)\b/i],
  ['Altar Call', /\b(just as i am|come to jesus|come as you are|invitation|softly and tenderly|i surrender all)\b/i],
  ['Kids', /\b(children|kids|jesus loves me|sunday school|this little light|deep and wide|b-i-b-l-e)\b/i],
  ['Victory', /\b(victory|triumph\w*|overcom\w*|warrior|battle|conquer\w*|stronger)\b/i],
];

const FAST_RE = /\b(dance|shout|celebrat\w*|clap|rejoice|victory|triumph\w*|hallelujah|hosanna|joy|jubilee|march\w*|fire|overcom\w*|warrior|alive|sing)\b/i;
const SLOW_RE = /\b(holy|still|peace|silent|quiet|abide|rest|hush|surrender\w*|communion|broken|lullaby|tender\w*|gentle|soft\w*|beneath|just as i am|stay|wretch|refuge|shelter)\b/i;

export function guessTags(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const [tag, re] of TAG_RULES) {
    if (re.test(text)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export function guessTempo(text: string): Tempo {
  const fast = FAST_RE.test(text);
  const slow = SLOW_RE.test(text);
  if (fast && !slow) return 'fast';
  if (slow && !fast) return 'slow';
  return 'medium';
}

export function classify(title: string, artist = ''): Classification {
  const lang = detectLanguage(`${title} ${artist}`.trim());
  // keyword rules are English; only apply them to Latin-script English-ish titles
  const english = lang.language === 'English' || lang.language === '';
  return {
    language: lang.language,
    languageGuessed: lang.guessed,
    tags: english ? guessTags(title) : [],
    tempo: english ? guessTempo(title) : 'medium',
  };
}

const LANG_ALIASES: Record<string, string> = {
  en: 'English', eng: 'English', english: 'English',
  hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
  ta: 'Tamil', tam: 'Tamil', tamil: 'Tamil',
  te: 'Telugu', tel: 'Telugu', telugu: 'Telugu',
  ml: 'Malayalam', mal: 'Malayalam', malayalam: 'Malayalam',
  kn: 'Kannada', kan: 'Kannada', kannada: 'Kannada',
  mr: 'Marathi', mar: 'Marathi', marathi: 'Marathi',
  bn: 'Bengali', ben: 'Bengali', bengali: 'Bengali', bangla: 'Bengali',
  gu: 'Gujarati', guj: 'Gujarati', gujarati: 'Gujarati',
  pa: 'Punjabi', pun: 'Punjabi', punjabi: 'Punjabi',
  ne: 'Nepali', nep: 'Nepali', nepali: 'Nepali',
  ur: 'Urdu', urdu: 'Urdu',
  es: 'Spanish', spa: 'Spanish', spanish: 'Spanish', espanol: 'Spanish', español: 'Spanish',
  pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese',
  fr: 'French', fre: 'French', french: 'French',
  ko: 'Korean', kor: 'Korean', korean: 'Korean',
  zh: 'Chinese', chi: 'Chinese', chinese: 'Chinese', mandarin: 'Chinese',
  sw: 'Swahili', swa: 'Swahili', swahili: 'Swahili',
};

export function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function normalizeLanguage(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return LANG_ALIASES[s.toLowerCase()] ?? titleCase(s);
}

export function normalizeTempo(raw: string): Tempo {
  const s = raw.trim().toLowerCase();
  if (!s) return '';
  if (/^(fast|up|upbeat|lively|quick|energetic|high|f)/.test(s)) return 'fast';
  if (/^(slow|soft|ballad|worshipful|gentle|calm|low|s)/.test(s)) return 'slow';
  if (/^(med|mid|moderate|normal|m)/.test(s)) return 'medium';
  return '';
}

export function normalizeTags(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[;|/,]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = titleCase(p);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}
