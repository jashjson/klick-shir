import { DEFAULT_OPTIONS, generateSet, matchesFilters, rerollOne } from '../lib/generate';
import { icon } from '../lib/icons';
import { allTags, get, languages, planSongs, saveSetToHistory, songById, today, update } from '../lib/store';
import { encodeSet, formatSetText, whatsappUrl } from '../lib/share';
import { buildSuggestions, THEMES, type SuggestionGroup } from '../lib/suggest';
import type { GenOptions, Song, Tempo } from '../lib/types';
import { $, copyText, esc, navigate, onAct, plural, toast } from './ui';

interface Preset { label: string; apply: Partial<GenOptions> }
const PRESETS: Preset[] = [
  { label: 'Opening 3', apply: { count: 3, flow: 'arc', tempos: ['fast', 'medium'] } },
  { label: 'Worship set · 5', apply: { count: 5, flow: 'arc', tempos: [] } },
  { label: 'Fellowship · 8', apply: { count: 8, flow: 'random', tempos: [] } },
  { label: 'Sing-along · 10', apply: { count: 10, flow: 'random', tempos: ['fast', 'medium'] } },
];

let showAllTags = false;
let notes: string[] = [];
let justAdded = new Set<string>();
let theme = '';
let sugSig = '';
let sugCache: SuggestionGroup[] = [];

const controls = () => $('#controls');
const setCard = () => $('#setCard');
const suggestCard = () => $('#suggestCard');

const TEMPO_LABEL: Record<string, string> = { fast: 'Fast', medium: 'Medium', slow: 'Slow', '': '' };

function setOption<K extends keyof GenOptions>(key: K, value: GenOptions[K]) {
  update((s) => { s.plan.options[key] = value; });
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/* ---------- generation ---------- */

function lockedSongs(): Song[] {
  return get().plan.items.filter((i) => i.locked).map((i) => songById(i.id)).filter((s): s is Song => !!s);
}

export function generate() {
  const s = get();
  if (!s.songs.length) { toast('Add some songs first.'); navigate('import'); return; }
  const locked = lockedSongs();
  const res = generateSet({ songs: s.songs, history: s.history, locked, options: s.plan.options });
  const lockedIds = new Set(locked.map((x) => x.id));
  notes = res.notes;
  justAdded = new Set(res.songs.filter((x) => !lockedIds.has(x.id)).map((x) => x.id));
  update((st) => { st.plan.items = res.songs.map((x) => ({ id: x.id, locked: lockedIds.has(x.id) })); });
}

function addToSet(id: string) {
  if (get().plan.items.some((i) => i.id === id)) { toast('Already in the set.'); return; }
  justAdded = new Set([id]);
  notes = [];
  update((s) => { s.plan.items.push({ id, locked: false }); });
}

/* ---------- controls ---------- */

function chip(label: string, count: number | null, pressed: boolean, attrs: string, state?: string): string {
  return `<button class="chip" aria-pressed="${pressed}" ${state ? `data-state="${state}"` : ''} ${attrs}>${esc(label)}${count !== null ? ` <small>${count}</small>` : ''}</button>`;
}

export function renderControls() {
  const s = get();
  const o = s.plan.options;
  const el = controls();
  if (!s.songs.length) {
    el.innerHTML = `<div class="empty"><div class="big">🎶</div><h3>Start with your song list</h3>
      <p>Upload a CSV or paste your songs. We’ll sort them by language and genre, then you can generate sets in one click.</p>
      <div class="actions" style="justify-content:center"><button class="btn primary" data-act="to-import">${icon('upload')} Import songs</button><button class="btn" data-act="sample">Try sample songs</button></div></div>`;
    return;
  }
  const langs = languages();
  const tags = allTags();
  const visibleTags = showAllTags ? tags : tags.slice(0, 14);
  const matches = s.songs.filter((x) => matchesFilters(x, o)).length;
  const filtered = o.languages.length || o.tags.length || o.excludeTags.length || o.tempos.length || o.favoritesOnly;

  el.innerHTML = `
    <div class="card-head"><div><h2>Build a set</h2><p>Choose the rules, we do the picking.</p></div></div>
    <div class="chips" aria-label="Quick start">${PRESETS.map((p, i) => `<button class="chip" data-act="preset" data-i="${i}">${icon('sparkles')} ${esc(p.label)}</button>`).join('')}</div>

    <div class="field"><label for="countInput">How many songs</label>
      <div class="stepper"><button data-act="dec" aria-label="Fewer songs">−</button><input id="countInput" type="number" min="1" max="40" value="${o.count}" data-opt="count" /><button data-act="inc" aria-label="More songs">+</button></div>
    </div>

    ${langs.length > 1 ? `<div class="field"><span class="label">Languages <span style="text-transform:none;letter-spacing:0">· none selected = all</span></span>
      <div class="chips">${langs.map((l) => chip(l.name, l.count, o.languages.includes(l.name), `data-act="lang" data-v="${esc(l.name)}"`)).join('')}</div></div>` : ''}

    ${tags.length ? `<div class="field"><span class="label">Genre &amp; themes <span style="text-transform:none;letter-spacing:0">· click to include, again to exclude</span></span>
      <div class="chips">${visibleTags.map((t) => {
        const inc = o.tags.includes(t.name); const exc = o.excludeTags.includes(t.name);
        return chip(t.name, t.count, inc, `data-act="tag" data-v="${esc(t.name)}"`, exc ? 'exclude' : undefined);
      }).join('')}${tags.length > 14 ? `<button class="chip" data-act="more-tags">${showAllTags ? 'Show less' : `+${tags.length - 14} more`}</button>` : ''}</div>
      ${o.tags.length > 1 ? `<label class="switch"><span>Must match all selected genres</span><input type="checkbox" data-opt="tagAll" ${o.tagMode === 'all' ? 'checked' : ''}></label>` : ''}</div>` : ''}

    <div class="field"><span class="label">Tempo</span>
      <div class="chips">${(['fast', 'medium', 'slow'] as Tempo[]).map((t) => chip(TEMPO_LABEL[t]!, null, o.tempos.includes(t), `data-act="tempo" data-v="${t}"`)).join('')}</div></div>

    <div class="field">
      <label class="switch"><span>Balance languages<small>Share the set across languages evenly</small></span><input type="checkbox" data-opt="balanceLanguages" ${o.balanceLanguages ? 'checked' : ''}></label>
      <label class="switch"><span>Prefer songs not sung lately<small>Fresh songs get picked more often</small></span><input type="checkbox" data-opt="preferFresh" ${o.preferFresh ? 'checked' : ''}></label>
      <label class="switch"><span>Favourites only</span><input type="checkbox" data-opt="favoritesOnly" ${o.favoritesOnly ? 'checked' : ''}></label>
    </div>

    <div class="field inline-selects">
      <div><label for="oFlow">Order</label><select id="oFlow" data-opt="flow"><option value="arc" ${o.flow === 'arc' ? 'selected' : ''}>Lively → quiet</option><option value="random" ${o.flow === 'random' ? 'selected' : ''}>Random</option></select></div>
      <div><label for="oAvoid">Skip songs from last</label><select id="oAvoid" data-opt="avoidRecentSets">${[0, 1, 2, 3, 4, 6].map((n) => `<option value="${n}" ${o.avoidRecentSets === n ? 'selected' : ''}>${n === 0 ? 'Don’t skip' : plural(n, 'set')}</option>`).join('')}</select></div>
      <div><label for="oArtist">Max per artist</label><select id="oArtist" data-opt="maxPerArtist">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${o.maxPerArtist === n ? 'selected' : ''}>${n === 0 ? 'No limit' : n}</option>`).join('')}</select></div>
    </div>

    <p class="match-line"><b>${matches}</b> of ${s.songs.length} songs match${filtered ? ` · <button class="btn sm ghost" data-act="reset">Clear filters</button>` : ''}</p>
    <button class="btn primary big" data-act="generate">${icon('dice')} ${s.plan.items.length ? 'Generate again' : 'Generate set'}</button>
  `;
}

function initControls() {
  const el = controls();
  onAct(el, (act, b) => {
    const o = get().plan.options;
    switch (act) {
      case 'to-import': navigate('import'); break;
      case 'sample': document.dispatchEvent(new CustomEvent('selah:sample')); break;
      case 'preset': {
        const p = PRESETS[Number(b.dataset.i)]!;
        update((s) => { s.plan.options = { ...s.plan.options, ...p.apply }; });
        generate();
        break;
      }
      case 'dec': setOption('count', Math.max(1, o.count - 1)); break;
      case 'inc': setOption('count', Math.min(40, o.count + 1)); break;
      case 'lang': setOption('languages', toggleIn(o.languages, b.dataset.v!)); break;
      case 'tempo': setOption('tempos', toggleIn(o.tempos, b.dataset.v!) as Tempo[]); break;
      case 'tag': {
        const v = b.dataset.v!;
        // off → include → exclude → off
        update((s) => {
          const p = s.plan.options;
          if (p.tags.includes(v)) { p.tags = p.tags.filter((x) => x !== v); p.excludeTags = [...p.excludeTags, v]; }
          else if (p.excludeTags.includes(v)) p.excludeTags = p.excludeTags.filter((x) => x !== v);
          else p.tags = [...p.tags, v];
        });
        break;
      }
      case 'more-tags': showAllTags = !showAllTags; renderControls(); break;
      case 'reset':
        update((s) => { Object.assign(s.plan.options, { languages: [], tags: [], excludeTags: [], tempos: [], favoritesOnly: false, tagMode: 'any' }); });
        break;
      case 'generate': generate(); break;
    }
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement | HTMLSelectElement;
    const opt = t.dataset.opt;
    if (!opt) return;
    switch (opt) {
      case 'count': setOption('count', Math.min(40, Math.max(1, Math.round(Number(t.value)) || DEFAULT_OPTIONS.count))); break;
      case 'tagAll': setOption('tagMode', (t as HTMLInputElement).checked ? 'all' : 'any'); break;
      case 'flow': setOption('flow', t.value as GenOptions['flow']); break;
      case 'avoidRecentSets': setOption('avoidRecentSets', Number(t.value)); break;
      case 'maxPerArtist': setOption('maxPerArtist', Number(t.value)); break;
      default: setOption(opt as 'balanceLanguages' | 'preferFresh' | 'favoritesOnly', (t as HTMLInputElement).checked);
    }
  });
}

/* ---------- the set ---------- */

function songSub(s: Song): string {
  const bits: string[] = [];
  if (s.artist) bits.push(`<span>${esc(s.artist)}</span>`);
  if (s.language) bits.push(`<span class="chip lang">${esc(s.language)}</span>`);
  if (s.tempo) bits.push(`<span class="tempo-dot" data-t="${s.tempo}">${TEMPO_LABEL[s.tempo]}</span>`);
  for (const t of s.tags.slice(0, 3)) bits.push(`<span class="chip tag">${esc(t)}</span>`);
  return bits.join('');
}

export function renderSet() {
  const s = get();
  const songs = planSongs();
  const st = s.settings;
  const mins = songs.length * st.minutesPerSong;
  const el = setCard();

  const meta = `<div class="setmeta"><input type="text" id="evName" placeholder="Event name, e.g. Sunday Service" value="${esc(s.plan.event)}" aria-label="Event name" /><input type="date" id="evDate" value="${esc(s.plan.date)}" aria-label="Date" /></div>`;

  if (!songs.length) {
    el.innerHTML = `<div class="card-head"><div><h2>Your set</h2><p>Nothing yet</p></div></div>${meta}
      <div class="empty"><div class="big">🎵</div><h3>Your set will appear here</h3><p>Hit <b>Generate set</b>, or search the library to add songs by hand.</p></div>${addBox()}`;
    return;
  }

  const lockedN = s.plan.items.filter((i) => i.locked).length;
  const langMix = [...songs.reduce((m, x) => m.set(x.language || 'Unknown', (m.get(x.language || 'Unknown') ?? 0) + 1), new Map<string, number>())];

  el.innerHTML = `
    <div class="card-head"><div><h2>Your set</h2><p>${plural(songs.length, 'song')}${lockedN ? ` · ${lockedN} locked` : ''}</p></div>
      <div class="row"><button class="btn sm" data-act="regen" title="Keeps locked songs">${icon('dice')} Re-roll unlocked</button><button class="btn sm danger" data-act="clear">Clear</button></div></div>
    ${meta}
    ${notes.length ? `<div class="notice">${notes.map(esc).join('<br>')}</div>` : ''}
    <ol class="songs">${songs.map((x, i) => {
      const item = s.plan.items[i]!;
      return `<li class="song ${item.locked ? 'locked' : ''} ${justAdded.has(x.id) ? 'just' : ''}" data-tempo="${x.tempo || 'medium'}" data-id="${x.id}">
        <span class="num">${i + 1}</span>
        <div><div class="song-title">${esc(x.title)}</div><div class="song-sub">${songSub(x)}</div></div>
        <div class="row-actions">
          <button class="mini fav" data-act="fav" aria-pressed="${x.favorite}" aria-label="Favourite" title="Favourite">${icon('star')}</button>
          <button class="mini" data-act="lock" aria-pressed="${item.locked}" aria-label="${item.locked ? 'Unlock' : 'Lock'} song" title="${item.locked ? 'Locked: stays when you re-roll' : 'Lock so it stays'}">${icon(item.locked ? 'lock' : 'unlock')}</button>
          <button class="mini" data-act="reroll" aria-label="Swap for another song" title="Swap for another" ${item.locked ? 'disabled' : ''}>${icon('refresh')}</button>
          <button class="mini" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="mini" data-act="down" aria-label="Move down" ${i === songs.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="mini" data-act="remove" aria-label="Remove from set">${icon('x')}</button>
        </div></li>`;
    }).join('')}</ol>
    ${addBox()}
    <div class="summary">
      <span>≈ <b>${mins} min</b> <select data-set="minutesPerSong" aria-label="Minutes per song">${[3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${st.minutesPerSong === n ? 'selected' : ''}>${n} min/song</option>`).join('')}</select></span>
      <span class="flow" title="Energy flow of the set">${songs.map((x) => `<i data-t="${x.tempo || 'medium'}"></i>`).join('')}</span>
      <span class="legend"><span><i class="f"></i>fast</span><span><i></i>medium</span><span><i class="s"></i>slow</span></span>
      ${langMix.length > 1 ? `<span>${langMix.map(([l, n]) => `${esc(l)} ${n}`).join(' · ')}</span>` : ''}
    </div>
    <div class="actions">
      <button class="btn primary" data-act="present">${icon('play')} Present</button>
      <button class="btn" data-act="copy">${icon('copy')} Copy</button>
      <button class="btn" data-act="whatsapp">${icon('message')} WhatsApp</button>
      <button class="btn" data-act="link">${icon('link')} Share link</button>
      <button class="btn" data-act="print">${icon('printer')} Print</button>
      <button class="btn" data-act="save">${icon('save')} Mark as sung</button>
    </div>
    <div class="row" style="margin-top:10px;gap:16px">
      <label class="row" style="gap:6px"><input type="checkbox" data-set="showArtist" ${st.showArtist ? 'checked' : ''}> Include artist</label>
      <label class="row" style="gap:6px"><input type="checkbox" data-set="showLanguage" ${st.showLanguage ? 'checked' : ''}> Include language</label>
    </div>`;
}

function addBox(): string {
  return `<div class="add-box"><input type="search" id="addSearch" placeholder="Add a song by name…" autocomplete="off" aria-label="Add a song to the set" /><div class="add-results" id="addResults" hidden></div></div>`;
}

function setText(): string {
  const s = get();
  return formatSetText(planSongs(), { title: s.plan.event, date: s.plan.date, showArtist: s.settings.showArtist, showLanguage: s.settings.showLanguage });
}

function move(i: number, d: -1 | 1) {
  update((s) => {
    const items = s.plan.items;
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j]!, items[i]!];
  });
}

function initSet() {
  const el = setCard();
  onAct(el, async (act, b) => {
    const li = b.closest<HTMLElement>('.song');
    const id = li?.dataset.id;
    const idx = li ? [...li.parentElement!.children].indexOf(li) : -1;
    const s = get();
    switch (act) {
      case 'regen': generate(); break;
      case 'clear': notes = []; update((st) => { st.plan.items = []; }); break;
      case 'fav': { const song = songById(id!); if (song) update((st) => { st.songs.find((x) => x.id === song.id)!.favorite = !song.favorite; }); break; }
      case 'lock': update((st) => { st.plan.items[idx]!.locked = !st.plan.items[idx]!.locked; }); break;
      case 'up': justAdded = new Set(); move(idx, -1); break;
      case 'down': justAdded = new Set(); move(idx, 1); break;
      case 'remove': justAdded = new Set(); update((st) => { st.plan.items.splice(idx, 1); }); break;
      case 'reroll': {
        const cur = planSongs();
        const pick = rerollOne({ songs: s.songs, history: s.history, current: cur, replacing: cur[idx]!, options: s.plan.options });
        if (!pick) { toast('No other song fits your filters.'); break; }
        justAdded = new Set([pick.id]);
        update((st) => { st.plan.items[idx] = { id: pick.id, locked: false }; });
        break;
      }
      case 'add': addToSet(b.dataset.id!); break;
      case 'copy': toast((await copyText(setText())) ? 'Copied: paste it anywhere.' : 'Could not copy.'); break;
      case 'whatsapp': window.open(whatsappUrl(setText()), '_blank', 'noopener'); break;
      case 'link': {
        const url = `${location.origin}${location.pathname}?set=${encodeSet(planSongs(), s.plan.event, s.plan.date)}`;
        toast((await copyText(url)) ? 'Link copied. It opens a read-only view of this set.' : 'Could not copy.');
        break;
      }
      case 'print': printSet(); break;
      case 'present': openPresent(); break;
      case 'save': {
        const last = s.history[0];
        const ids = s.plan.items.map((i) => i.id).join();
        if (last && last.date === s.plan.date && last.songIds.join() === ids) { toast('This set is already in History.'); break; }
        const e = saveSetToHistory();
        if (e) update((st) => st.plan.items.forEach((i) => (i.locked = false)));
        if (e) toast(`Saved. The next ${plural(s.plan.options.avoidRecentSets || 0, 'set')} will skip these songs.`);
        break;
      }
    }
  });

  el.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.id === 'evName') update((s) => { s.plan.event = t.value; }, { silent: true });
    else if (t.id === 'evDate') update((s) => { s.plan.date = t.value || today(); }, { silent: true });
    else if (t.id === 'addSearch') showAddResults(t.value);
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement | HTMLSelectElement;
    const k = t.dataset.set;
    if (!k) return;
    if (k === 'minutesPerSong') update((s) => { s.settings.minutesPerSong = Number(t.value); });
    else update((s) => { s.settings[k as 'showArtist' | 'showLanguage'] = (t as HTMLInputElement).checked; });
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.target as HTMLElement).id === 'addSearch') {
      const first = $('#addResults').querySelector<HTMLElement>('[data-id]');
      if (first) first.click();
    }
  });
}

function showAddResults(q: string) {
  const box = $('#addResults');
  const query = q.trim().toLowerCase();
  if (!query) { box.hidden = true; return; }
  const inSet = new Set(get().plan.items.map((i) => i.id));
  const hits = get().songs
    .filter((s) => !inSet.has(s.id) && `${s.title} ${s.artist} ${s.tags.join(' ')}`.toLowerCase().includes(query))
    .slice(0, 8);
  box.hidden = false;
  box.innerHTML = hits.length
    ? hits.map((s) => `<button data-act="add" data-id="${s.id}">${esc(s.title)} <small>${esc([s.artist, s.language].filter(Boolean).join(' · '))}</small></button>`).join('')
    : `<button disabled>No matching songs</button>`;
}

/* ---------- suggestions ---------- */

export function renderSuggestions(force = false) {
  const s = get();
  const el = suggestCard();
  if (!s.songs.length) { el.hidden = true; return; }
  el.hidden = false;
  const sig = [s.songs.length, s.history.length, s.plan.items.map((i) => i.id).join(), theme].join('|');
  if (force || sig !== sugSig) {
    sugSig = sig;
    sugCache = buildSuggestions({ songs: s.songs, set: planSongs(), history: s.history, theme });
  }
  const groups = sugCache;
  el.innerHTML = `
    <div class="card-head"><div><h2>Suggestions</h2><p>Ideas based on your set, your history and the church calendar</p></div>
      <button class="btn sm" data-act="shuffle">${icon('refresh')} Shuffle ideas</button></div>
    <div class="theme-row"><input type="search" id="themeInput" placeholder="Need a theme? Try grace, healing, victory…" value="${esc(theme)}" aria-label="Theme" /><button class="btn" data-act="theme-go">Find</button></div>
    <div class="chips">${Object.keys(THEMES).map((t) => `<button class="chip" aria-pressed="${theme.toLowerCase() === t.toLowerCase()}" data-act="theme" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div style="margin-top:18px">${groups.length ? groups.map(groupHtml).join('') : `<p class="empty">Build a set and ideas will appear here.</p>`}</div>`;
}

function groupHtml(g: SuggestionGroup): string {
  return `<div class="sgroup"><h3>${esc(g.title)} <small>${esc(g.hint)}</small></h3><div class="sitems">${
    g.items.length
      ? g.items.map((i) => `<div class="sitem"><div><div class="song-title">${esc(i.song.title)}</div><div class="song-sub"><span class="why">${esc(i.reason)}</span>${i.song.artist ? `<span>· ${esc(i.song.artist)}</span>` : ''}${i.song.language ? `<span class="chip lang">${esc(i.song.language)}</span>` : ''}</div></div>
        <button class="mini add" data-act="sug-add" data-id="${i.song.id}" aria-label="Add ${esc(i.song.title)} to set" title="Add to set">${icon('plus')}</button></div>`).join('')
      : `<p class="song-sub">No songs found. Try another word.</p>`
  }</div></div>`;
}

function initSuggestions() {
  const el = suggestCard();
  onAct(el, (act, b) => {
    switch (act) {
      case 'shuffle': renderSuggestions(true); break;
      case 'theme': theme = theme.toLowerCase() === b.dataset.v!.toLowerCase() ? '' : b.dataset.v!; renderSuggestions(true); break;
      case 'theme-go': theme = $<HTMLInputElement>('#themeInput', el).value.trim(); renderSuggestions(true); break;
      case 'sug-add': addToSet(b.dataset.id!); break;
    }
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.target as HTMLElement).id === 'themeInput') {
      theme = (ev.target as HTMLInputElement).value.trim();
      renderSuggestions(true);
    }
  });
}

/* ---------- print & present ---------- */

function printSet() {
  const s = get();
  const songs = planSongs();
  $('#printSheet').innerHTML = `<h1>${esc(s.plan.event || 'Song set')}</h1><p>${esc(s.plan.date)}</p><ol>${songs.map((x) =>
    `<li>${esc(x.title)}${s.settings.showArtist && x.artist ? ` <small>${esc(x.artist)}</small>` : ''}${s.settings.showLanguage && x.language ? ` <small>[${esc(x.language)}]</small>` : ''}</li>`).join('')}</ol>`;
  window.print();
}

let presentIdx = 0;
function renderPresent() {
  const s = get();
  const songs = planSongs();
  $('#presentBody').innerHTML = `
    <div class="present-head"><span>${esc(s.plan.event || 'Song set')}</span><button class="btn sm ghost" data-act="p-close" style="color:#fff">Close ✕</button></div>
    <div class="present-list">${songs.map((x, i) => `<button class="present-item ${i === presentIdx ? 'now' : ''}" data-act="p-go" data-i="${i}"><span class="n">${i + 1}</span><span class="tt">${esc(x.title)}${s.settings.showArtist && x.artist ? `<small>${esc(x.artist)}</small>` : ''}</span></button>`).join('')}</div>
    <p class="present-hint">← → to move · Esc to close</p>`;
  $('#presentBody .now')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function openPresent() {
  if (!planSongs().length) { toast('Generate a set first.'); return; }
  presentIdx = 0;
  renderPresent();
  $<HTMLDialogElement>('#presentDialog').showModal();
}

function initPresent() {
  const dlg = $<HTMLDialogElement>('#presentDialog');
  onAct($('#presentBody'), (act, b) => {
    if (act === 'p-close') dlg.close();
    if (act === 'p-go') { presentIdx = Number(b.dataset.i); renderPresent(); }
  });
  dlg.addEventListener('keydown', (ev) => {
    const n = planSongs().length;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === ' ') { ev.preventDefault(); presentIdx = Math.min(n - 1, presentIdx + 1); renderPresent(); }
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); presentIdx = Math.max(0, presentIdx - 1); renderPresent(); }
  });
}

export function initPlan() {
  initControls();
  initSet();
  initSuggestions();
  initPresent();
  document.addEventListener('click', (ev) => {
    if (!(ev.target as HTMLElement).closest('.add-box')) {
      const r = document.getElementById('addResults');
      if (r) r.hidden = true;
    }
  });
}

export function renderPlan() {
  renderControls();
  renderSet();
  renderSuggestions();
}
