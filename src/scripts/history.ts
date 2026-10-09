import { daysSince } from '../lib/generate';
import { icon } from '../lib/icons';
import { formatDate, formatSetText } from '../lib/share';
import { get, songById, update } from '../lib/store';
import { $, copyText, esc, navigate, onAct, plural, toast } from './ui';

export function renderHistory() {
  const s = get();
  const counts = new Map<string, { title: string; n: number }>();
  for (const h of s.history) {
    for (const it of h.snapshot) {
      const c = counts.get(it.id) ?? { title: it.title, n: 0 };
      c.n++;
      counts.set(it.id, c);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  const max = top[0]?.n ?? 1;
  const never = s.songs.filter((x) => !counts.has(x.id)).length;

  $('#histStats').innerHTML = `
    <div class="card-head"><div><h2>Your patterns</h2><p>What the generator learns from</p></div></div>
    <div class="stats">
      <div class="stat"><b>${s.history.length}</b><span>saved sets</span></div>
      <div class="stat"><b>${counts.size}</b><span>songs used</span></div>
      <div class="stat"><b>${never}</b><span>never sung</span></div>
    </div>
    ${top.length ? `<span class="label">Most sung</span>${top.map((t) => `<div class="rank"><span>${esc(t.title)}</span><i style="width:${(t.n / max) * 100}%"></i><b>${t.n}</b></div>`).join('')}`
      : `<p class="song-sub">Build a set and press <b>Mark as sung</b>. Selah will then avoid repeats and surface forgotten songs.</p>`}`;

  const list = $('#histList');
  if (!s.history.length) { list.innerHTML = `<div class="empty"><div class="big">🕘</div><p>No saved sets yet.</p></div>`; return; }
  const now = new Date();
  list.innerHTML = s.history.map((h) => {
    const age = daysSince(h.date, now);
    return `<div class="hentry" data-id="${h.id}">
      <div class="card-head" style="margin:0"><div><h3>${esc(h.event || 'Song set')}</h3><p>${esc(formatDate(h.date))} · ${age === 0 ? 'today' : `${plural(age, 'day')} ago`} · ${plural(h.snapshot.length, 'song')}</p></div>
        <div class="row"><button class="btn sm" data-act="load">Use again</button><button class="mini" data-act="copy" aria-label="Copy">${icon('copy')}</button><button class="mini" data-act="del" aria-label="Delete">${icon('trash')}</button></div></div>
      <ol>${h.snapshot.map((x) => `<li>${esc(x.title)}${x.artist ? ` <small>${esc(x.artist)}</small>` : ''}</li>`).join('')}</ol></div>`;
  }).join('');
}

export function initHistory() {
  onAct($('#histList'), async (act, b) => {
    const id = b.closest<HTMLElement>('.hentry')!.dataset.id!;
    const h = get().history.find((x) => x.id === id);
    if (!h) return;
    if (act === 'del') {
      if (confirm('Delete this saved set? Songs in it will count as unsung again.')) update((s) => { s.history = s.history.filter((x) => x.id !== id); });
    } else if (act === 'copy') {
      const text = formatSetText(h.snapshot.map((x) => ({ ...x, tags: [], tempo: '', key: '', notes: '', favorite: false, review: false, addedAt: 0 })), {
        title: h.event, date: h.date, showArtist: get().settings.showArtist, showLanguage: get().settings.showLanguage,
      });
      toast((await copyText(text)) ? 'Copied.' : 'Could not copy.');
    } else if (act === 'load') {
      const items = h.songIds.filter((sid) => songById(sid)).map((sid) => ({ id: sid, locked: false }));
      if (!items.length) { toast('Those songs are no longer in your library.'); return; }
      update((s) => { s.plan.items = items; s.plan.event = h.event; });
      toast(items.length < h.songIds.length ? 'Loaded (some songs were deleted from the library).' : 'Loaded into the planner.');
      navigate('plan');
    }
  });
}
