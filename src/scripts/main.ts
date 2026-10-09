import { icon } from '../lib/icons';
import { decodeSet, formatSetText } from '../lib/share';
import { get, initStore, subscribe } from '../lib/store';
import { initHistory, renderHistory } from './history';
import { initImport, renderPreview } from './importer';
import { initLibrary, renderLibrary } from './library';
import { initPlan, renderPlan } from './plan';
import { $, copyText, esc, toast } from './ui';

type Tab = 'plan' | 'library' | 'import' | 'history';
const TABS: Tab[] = ['plan', 'library', 'import', 'history'];

function currentTab(): Tab {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.includes(h) ? h : 'plan';
}

function showTab() {
  const t = currentTab();
  for (const name of TABS) $(`#panel-${name}`).hidden = name !== t;
  document.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  window.scrollTo({ top: 0 });
}

function renderAll() {
  renderPlan();
  renderLibrary();
  renderHistory();
  renderPreview();
}

function setTheme(t: 'light' | 'dark') {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('selah:theme', t); } catch { /* private mode */ }
  $('#themeBtn').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
}

function showShared() {
  const raw = new URLSearchParams(location.search).get('set');
  if (!raw) return;
  const data = decodeSet(raw);
  if (!data || !data.songs.length) { toast('That shared link looks broken.'); return; }
  const dlg = $<HTMLDialogElement>('#sharedDialog');
  const text = formatSetText(
    data.songs.map((s) => ({ id: '', ...s, tags: [], tempo: '' as const, key: '', notes: '', favorite: false, review: false, addedAt: 0 })),
    { title: data.event, date: data.date, showArtist: true, showLanguage: false },
  );
  $('#sharedBody').innerHTML = `<h2>${esc(data.event || 'Shared song set')}</h2>
    <ol class="song-list" style="padding-left:22px;line-height:1.9">${data.songs.map((s) => `<li><b>${esc(s.title)}</b>${s.artist ? ` <span style="color:var(--muted)">${esc(s.artist)}</span>` : ''}${s.language ? ` <span class="chip lang">${esc(s.language)}</span>` : ''}</li>`).join('')}</ol>
    <div class="dlg-foot"><button class="btn" id="sharedCopy">${icon('copy')} Copy list</button><button class="btn primary" id="sharedClose">Open Selah</button></div>`;
  $('#sharedCopy').addEventListener('click', async () => toast((await copyText(text)) ? 'Copied.' : 'Could not copy.'));
  $('#sharedClose').addEventListener('click', () => { dlg.close(); history.replaceState(null, '', location.pathname + location.hash); });
  dlg.showModal();
}

function init() {
  initStore();
  $('#brandMark').innerHTML = icon('music');
  setTheme((document.documentElement.dataset.theme as 'light' | 'dark') || 'light');
  $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  document.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.tab!; }));
  window.addEventListener('hashchange', showTab);

  initPlan();
  initLibrary();
  initImport();
  initHistory();
  subscribe(renderAll);
  renderAll();
  showTab();
  showShared();

  // first-time visitors land on Plan with the empty state; nothing else to do
  void get;
}

init();
