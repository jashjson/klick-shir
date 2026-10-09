import { parseSongs, type DashMode, type ParseResult } from '../lib/parse';
import { normalizeLanguage, normalizeTags } from '../lib/classify';
import { SAMPLE_CSV } from '../lib/sample';
import { buildSong, exportBackup, get, importRows, previewDuplicates, restoreBackup, update, type ImportOptions } from '../lib/store';
import { songsToCSV } from '../lib/share';
import { $, debounce, download, esc, navigate, plural, toast } from './ui';

let result: ParseResult | null = null;

const val = (id: string) => $<HTMLInputElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;

function options(): ImportOptions {
  return {
    autoCategorize: checked('#oAuto'),
    defaultLanguage: val('#oLang'),
    defaultTags: normalizeTags(val('#oTags')),
    onDuplicate: val('#oDupe') as ImportOptions['onDuplicate'],
  };
}

function reparse() {
  const text = val('#pasteBox');
  result = text.trim()
    ? parseSongs(text, { dashMode: val('#oDash') as DashMode, forceLines: checked('#oLines') })
    : null;
  renderPreview();
}

export function renderPreview() {
  const el = $('#previewCard');
  if (!result || !result.rows.length) {
    el.innerHTML = `<div class="card-head"><div><h2>Preview</h2><p>What we found will show up here before anything is saved.</p></div></div>
      <div class="empty"><div class="big">📄</div><p>${result ? 'We couldn’t find any songs in that text.' : 'Drop a file or paste a list to begin.'}</p></div>`;
    return;
  }
  const o = options();
  const rows = result.rows;
  const dupes = previewDuplicates(rows);
  const built = rows.slice(0, 10).map((r) => buildSong(r, o));
  const guesses = rows.map((r) => buildSong(r, o)).filter((s) => s.review).length;
  el.innerHTML = `
    <div class="card-head"><div><h2>Preview</h2><p><b>${plural(rows.length, 'song')}</b> found${dupes ? ` · ${dupes} already in your library` : ''}${guesses ? ` · ${guesses} auto-categorised guesses to review` : ''}</p></div></div>
    ${result.format === 'table' ? `<div class="mapping">Columns: ${result.mapping.map((m) => `<span>${esc(m.column)} → ${esc(m.field)}</span>`).join('')}</div>` : ''}
    <div style="overflow:auto"><table class="preview-table"><thead><tr><th>Title</th><th>Artist</th><th>Language</th><th>Genre</th><th>Tempo</th></tr></thead><tbody>
      ${built.map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.language) || '–'}</td><td>${esc(s.tags.join(', ')) || '–'}</td><td>${esc(s.tempo) || '–'}</td></tr>`).join('')}
    </tbody></table></div>
    ${rows.length > 10 ? `<p class="match-line">…and ${rows.length - 10} more</p>` : ''}
    ${result.skipped ? `<p class="match-line">${plural(result.skipped, 'empty row')} skipped</p>` : ''}
    <button class="btn primary big" id="doImport" style="margin-top:12px">${plural(rows.length - (o.onDuplicate === 'skip' ? dupes : 0), 'song')} → add to library</button>`;
  $('#doImport').addEventListener('click', doImport);
}

function doImport() {
  if (!result) return;
  const sum = importRows(result.rows, options());
  const parts = [`Added ${plural(sum.added, 'song')}`];
  if (sum.updated) parts.push(`${sum.updated} updated`);
  if (sum.skipped) parts.push(`${sum.skipped} duplicates skipped`);
  toast(parts.join(' · ') + (sum.needReview ? '. Check the guessed ones in Library.' : '.'), 4500);
  $<HTMLTextAreaElement>('#pasteBox').value = '';
  result = null;
  renderPreview();
  navigate('library');
}

async function readFile(file: File) {
  if (/\.(xlsx?|docx?|pdf|numbers)$/i.test(file.name)) {
    toast('Export that file as CSV first (File → Download → CSV), then drop it here.', 5500);
    return;
  }
  $<HTMLTextAreaElement>('#pasteBox').value = await file.text();
  reparse();
  toast(`Loaded ${file.name}`);
}

export function loadSample() {
  const parsed = parseSongs(SAMPLE_CSV);
  const sum = importRows(parsed.rows, { autoCategorize: false, defaultLanguage: '', defaultTags: [], onDuplicate: 'skip' });
  toast(sum.added ? `Added ${sum.added} sample songs. Try generating a set!` : 'Sample songs are already in your library.');
  navigate('plan');
}

export function initImport() {
  const drop = $('#drop');
  $<HTMLInputElement>('#fileInput').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void readFile(f);
    (e.target as HTMLInputElement).value = '';
  });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void readFile(f);
  });

  const re = debounce(reparse, 150);
  $('#pasteBox').addEventListener('input', re);
  for (const id of ['#oDash', '#oDupe', '#oAuto', '#oLines']) $(id).addEventListener('change', reparse);
  for (const id of ['#oLang', '#oTags']) $(id).addEventListener('input', re);

  $('#sampleBtn').addEventListener('click', loadSample);
  document.addEventListener('selah:sample', loadSample);
  $('#templateBtn').addEventListener('click', () => {
    download('selah-template.csv', 'Title,Artist,Language,Genre,Tempo\nAmazing Grace,John Newton,English,"Hymn, Grace",slow\nYeshu Mera Sahara,,Hindi,Worship,medium\n', 'text/csv');
  });
  $('#exportCsvBtn').addEventListener('click', () => {
    if (!get().songs.length) { toast('Nothing to export yet.'); return; }
    download('selah-library.csv', songsToCSV(get().songs), 'text/csv');
  });
  $('#backupBtn').addEventListener('click', () => {
    download(`selah-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(), 'application/json');
    toast('Backup downloaded. Keep it somewhere safe.');
  });
  $<HTMLInputElement>('#restoreInput').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (get().songs.length && !confirm('Restoring replaces your current library and history. Continue?')) return;
    const r = restoreBackup(await f.text());
    toast(r ? `Restored ${plural(r.songs, 'song')} and ${plural(r.history, 'saved set')}.` : 'That doesn’t look like a Selah backup.');
    (e.target as HTMLInputElement).value = '';
  });
  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('Erase all songs, history and settings from this browser? Download a backup first if unsure.')) return;
    update((s) => { s.songs = []; s.history = []; s.plan.items = []; });
    toast('Everything erased.');
  });
  void normalizeLanguage;
}
