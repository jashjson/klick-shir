import { daysSince, lastUsedMap } from '../lib/generate';
import { icon } from '../lib/icons';
import { normalizeLanguage, normalizeTags, titleCase } from '../lib/classify';
import { autoCategorize, allTags, get, languages, removeSongs, uid, update } from '../lib/store';
import type { Song, Tempo } from '../lib/types';
import { $, debounce, esc, onAct, plural, relativeDays, toast } from './ui';

const PAGE = 100;
const f = { q: '', lang: '', tag: '', tempo: '', flag: '', sort: 'title' };
let limit = PAGE;
const selected = new Set<string>();
let editingId: string | null = null;

const LANG_COLORS = ['#3d43a8', '#d9822b', '#2a9d8f', '#b9811f', '#c0392b', '#7b5ea7', '#4a8fd1', '#6b8e23'];

function filtered(): Song[] {
  const s = get();
  const last = lastUsedMap(s.history);
  const uses = new Map<string, number>();
  for (const h of s.history) for (const id of h.songIds) uses.set(id, (uses.get(id) ?? 0) + 1);
  const q = f.q.trim().toLowerCase();
  let list = s.songs.filter((x) => {
    if (q && !`${x.title} ${x.artist} ${x.tags.join(' ')} ${x.language} ${x.notes}`.toLowerCase().includes(q)) return false;
    if (f.lang && (x.language || 'Unknown') !== f.lang) return false;
    if (f.tag && !x.tags.includes(f.tag)) return false;
    if (f.tempo && x.tempo !== f.tempo) return false;
    if (f.flag === 'fav' && !x.favorite) return false;
    if (f.flag === 'review' && !x.review) return false;
    if (f.flag === 'never' && last.has(x.id)) return false;
    return true;
  });
  const now = new Date();
  switch (f.sort) {
    case 'recent': list = list.sort((a, b) => b.addedAt - a.addedAt); break;
    case 'lastused': list = list.sort((a, b) => daysSince(last.get(b.id), now) - daysSince(last.get(a.id), now) || a.title.localeCompare(b.title)); break;
    case 'used': list = list.sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.title.localeCompare(b.title)); break;
    default: list = list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }
  return list;
}

function renderFilters() {
  const langs = languages();
  const tags = allTags();
  const fl = $<HTMLSelectElement>('#fLang');
  const ft = $<HTMLSelectElement>('#fTag');
  fl.innerHTML = `<option value="">All languages</option>${langs.map((l) => `<option value="${esc(l.name)}" ${f.lang === l.name ? 'selected' : ''}>${esc(l.name)} (${l.count})</option>`).join('')}`;
  ft.innerHTML = `<option value="">All genres</option>${tags.map((t) => `<option value="${esc(t.name)}" ${f.tag === t.name ? 'selected' : ''}>${esc(t.name)} (${t.count})</option>`).join('')}`;
  $('#langList').innerHTML = langs.filter((l) => l.name !== 'Unknown').map((l) => `<option value="${esc(l.name)}">`).join('');
  $('#tagList').innerHTML = tags.map((t) => `<option value="${esc(t.name)}">`).join('');
}

function renderStats() {
  const s = get();
  const langs = languages();
  const review = s.songs.filter((x) => x.review).length;
  const fav = s.songs.filter((x) => x.favorite).length;
  const used = new Set(s.history.flatMap((h) => h.songIds));
  $('#libStats').innerHTML = s.songs.length ? `
    <div class="stat"><b>${s.songs.length}</b><span>songs</span></div>
    <div class="stat"><b>${langs.length}</b><span>${langs.length === 1 ? 'language' : 'languages'}</span>
      <div class="bars" title="${langs.map((l) => `${l.name}: ${l.count}`).join(', ')}">${langs.map((l, i) => `<i style="flex:${l.count};background:${LANG_COLORS[i % LANG_COLORS.length]}"></i>`).join('')}</div></div>
    <div class="stat"><b>${fav}</b><span>favourites</span></div>
    <div class="stat"><b>${s.songs.length - used.size}</b><span>never sung</span></div>
    ${review ? `<div class="stat"><b style="color:var(--gold)">${review}</b><span>need a quick review <button class="btn sm ghost" data-act="show-review">Show</button> <button class="btn sm ghost" data-act="ok-all">All good</button></span></div>` : ''}` : '';
}

function renderBulk() {
  const el = $('#bulkBar');
  if (!selected.size) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="bulk"><b>${selected.size} selected</b>
    <input type="text" id="bLang" list="langList" placeholder="Set language" /><button class="btn sm" data-act="b-lang">Apply</button>
    <input type="text" id="bTag" list="tagList" placeholder="Add genre / tag" /><button class="btn sm" data-act="b-tag">Add</button><button class="btn sm" data-act="b-untag">Remove</button>
    <select id="bTempo" aria-label="Set tempo"><option value="">Tempo…</option><option value="fast">Fast</option><option value="medium">Medium</option><option value="slow">Slow</option></select>
    <button class="btn sm" data-act="b-fav">${icon('star')} Favourite</button>
    <button class="btn sm" data-act="b-ok">Mark reviewed</button>
    <span class="grow"></span>
    <button class="btn sm danger" data-act="b-del">${icon('trash')} Delete</button>
    <button class="btn sm" data-act="b-clear">Clear</button></div>`;
}

export function renderLibrary() {
  const s = get();
  $('#libCount').textContent = s.songs.length ? String(s.songs.length) : '';
  renderFilters();
  renderStats();
  for (const id of [...selected]) if (!s.songs.some((x) => x.id === id)) selected.delete(id);
  renderBulk();
  const list = filtered();
  const el = $('#libList');
  if (!s.songs.length) {
    el.innerHTML = `<div class="empty"><div class="big">📚</div><h3>No songs yet</h3><p>Import a list and it will show up here, sorted and tagged.</p></div>`;
    return;
  }
  if (!list.length) { el.innerHTML = `<div class="empty"><h3>No songs match</h3><p>Try clearing a filter.</p></div>`; return; }
  const last = lastUsedMap(s.history);
  const now = new Date();
  const shown = list.slice(0, limit);
  const allSel = shown.every((x) => selected.has(x.id));
  el.innerHTML = `<div class="lib-list">
    <div class="lib-head"><input type="checkbox" data-act="sel-all" aria-label="Select all shown" ${allSel ? 'checked' : ''}><span></span><span>Song</span><span>Language</span><span>Genre</span><span>Tempo</span><span>Last sung</span><span></span></div>
    ${shown.map((x) => `<div class="lib-row ${selected.has(x.id) ? 'sel' : ''}" data-id="${x.id}">
      <input type="checkbox" data-act="sel" aria-label="Select ${esc(x.title)}" ${selected.has(x.id) ? 'checked' : ''}>
      <button class="mini fav" data-act="fav" aria-pressed="${x.favorite}" aria-label="Favourite">${icon('star')}</button>
      <div><div class="t">${esc(x.title)}</div>${x.artist ? `<div class="a">${esc(x.artist)}</div>` : ''}</div>
      <div class="c-lang">${x.language ? `<span class="chip lang">${esc(x.language)}</span>` : '<span class="chip review">No language</span>'} ${x.review ? '<span class="chip review" title="Guessed automatically: edit to confirm">check</span>' : ''}</div>
      <div class="c-tags chips">${x.tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>
      <div class="c-tempo"><span class="tempo-dot" data-t="${x.tempo}">${x.tempo ? titleCase(x.tempo) : '–'}</span></div>
      <div class="when">${esc(relativeDays(daysSince(last.get(x.id), now)))}</div>
      <button class="mini" data-act="edit" aria-label="Edit ${esc(x.title)}">${icon('pencil')}</button>
    </div>`).join('')}</div>
    <p class="match-line">Showing ${shown.length} of ${list.length}${list.length > shown.length ? ` · <button class="btn sm" data-act="more">Show ${Math.min(PAGE, list.length - shown.length)} more</button>` : ''}</p>`;
}

/* ---------- edit dialog ---------- */

function openEdit(id: string | null) {
  editingId = id;
  const song = id ? get().songs.find((x) => x.id === id) : undefined;
  $('#editTitle').textContent = song ? 'Edit song' : 'Add song';
  $<HTMLInputElement>('#eTitle').value = song?.title ?? '';
  $<HTMLInputElement>('#eArtist').value = song?.artist ?? '';
  $<HTMLInputElement>('#eLang').value = song?.language ?? '';
  $<HTMLInputElement>('#eTags').value = song?.tags.join(', ') ?? '';
  $<HTMLSelectElement>('#eTempo').value = song?.tempo ?? '';
  $<HTMLInputElement>('#eKey').value = song?.key ?? '';
  $<HTMLInputElement>('#eNotes').value = song?.notes ?? '';
  $<HTMLInputElement>('#eFav').checked = song?.favorite ?? false;
  $('#eDelete').hidden = !song;
  $<HTMLDialogElement>('#editDialog').showModal();
  $('#eTitle').focus();
}

function saveEdit() {
  const title = $<HTMLInputElement>('#eTitle').value.trim();
  if (!title) return;
  const data = {
    title,
    artist: $<HTMLInputElement>('#eArtist').value.trim(),
    language: normalizeLanguage($<HTMLInputElement>('#eLang').value),
    tags: normalizeTags($<HTMLInputElement>('#eTags').value),
    tempo: $<HTMLSelectElement>('#eTempo').value as Tempo,
    key: $<HTMLInputElement>('#eKey').value.trim(),
    notes: $<HTMLInputElement>('#eNotes').value.trim(),
    favorite: $<HTMLInputElement>('#eFav').checked,
    review: false,
  };
  update((s) => {
    const existing = editingId ? s.songs.find((x) => x.id === editingId) : undefined;
    if (existing) Object.assign(existing, data);
    else s.songs.push({ id: uid(), addedAt: Date.now(), ...data });
  });
  toast(editingId ? 'Saved.' : 'Song added.');
}

/* ---------- wiring ---------- */

function bulk(fn: (s: Song) => void, msg: string) {
  update((st) => { for (const x of st.songs) if (selected.has(x.id)) fn(x); });
  toast(msg);
}

export function initLibrary() {
  const rerender = renderLibrary;
  $('#libSearch').addEventListener('input', debounce((e: Event) => { f.q = (e.target as HTMLInputElement).value; limit = PAGE; rerender(); }, 120));
  const bind = (id: string, key: keyof typeof f) => $(id).addEventListener('change', (e) => { f[key] = (e.target as HTMLSelectElement).value; limit = PAGE; rerender(); });
  bind('#fLang', 'lang'); bind('#fTag', 'tag'); bind('#fTempo', 'tempo'); bind('#fFlag', 'flag'); bind('#fSort', 'sort');

  $('#addSongBtn').addEventListener('click', () => openEdit(null));
  $('#autoCatBtn').addEventListener('click', () => {
    const n = autoCategorize();
    toast(n ? `Categorised ${plural(n, 'song')}. Guesses are marked “check”.` : 'Nothing to fill in: every song already has language, genre and tempo.');
  });

  onAct($('#libStats'), (act) => {
    if (act === 'show-review') { f.flag = 'review'; $<HTMLSelectElement>('#fFlag').value = 'review'; rerender(); }
    if (act === 'ok-all') { update((s) => s.songs.forEach((x) => (x.review = false))); toast('All songs marked as reviewed.'); }
  });

  onAct($('#libList'), (act, b) => {
    const id = b.closest<HTMLElement>('.lib-row')?.dataset.id;
    switch (act) {
      case 'more': limit += PAGE; rerender(); break;
      case 'edit': openEdit(id!); break;
      case 'fav': update((s) => { const x = s.songs.find((y) => y.id === id)!; x.favorite = !x.favorite; }); break;
      case 'sel': { const on = (b as HTMLInputElement).checked; if (on) selected.add(id!); else selected.delete(id!); renderLibrary(); break; }
      case 'sel-all': {
        const on = (b as HTMLInputElement).checked;
        filtered().slice(0, limit).forEach((x) => (on ? selected.add(x.id) : selected.delete(x.id)));
        renderLibrary();
        break;
      }
    }
  });
  // double-click a row title to edit quickly
  $('#libList').addEventListener('dblclick', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.lib-row');
    if (row) openEdit(row.dataset.id!);
  });

  onAct($('#bulkBar'), (act) => {
    const ids = [...selected];
    switch (act) {
      case 'b-clear': selected.clear(); renderLibrary(); break;
      case 'b-del':
        if (confirm(`Delete ${plural(ids.length, 'song')}? This can't be undone.`)) { removeSongs(ids); selected.clear(); toast('Deleted.'); }
        break;
      case 'b-fav': bulk((x) => (x.favorite = true), 'Marked as favourites.'); break;
      case 'b-ok': bulk((x) => (x.review = false), 'Marked as reviewed.'); break;
      case 'b-lang': {
        const v = normalizeLanguage($<HTMLInputElement>('#bLang').value);
        if (v) bulk((x) => { x.language = v; x.review = false; }, `Language set to ${v}.`);
        break;
      }
      case 'b-tag': case 'b-untag': {
        const tags = normalizeTags($<HTMLInputElement>('#bTag').value);
        if (!tags.length) break;
        const add = act === 'b-tag';
        bulk((x) => {
          x.tags = add ? normalizeTags([...x.tags, ...tags]) : x.tags.filter((t) => !tags.some((n) => n.toLowerCase() === t.toLowerCase()));
          x.review = false;
        }, add ? 'Tag added.' : 'Tag removed.');
        break;
      }
    }
  });
  $('#bulkBar').addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.id === 'bTempo' && t.value) bulk((x) => (x.tempo = t.value as Tempo), `Tempo set to ${t.value}.`);
  });

  const dlg = $<HTMLDialogElement>('#editDialog');
  $('#editForm').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); dlg.close(); });
  $('#eCancel').addEventListener('click', () => dlg.close());
  $('#eDelete').addEventListener('click', () => {
    if (editingId && confirm('Delete this song?')) { removeSongs([editingId]); dlg.close(); toast('Deleted.'); }
  });
}
