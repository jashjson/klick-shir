# Selah: song sets in seconds

Upload your song list, let Selah categorise it, then generate a balanced set for church or fellowship in one click.
Everything runs in the browser. Songs and history are stored in `localStorage`, so there's no server, account or tracking.

## Run it

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static site in dist/ (host anywhere: Netlify, GitHub Pages, a USB stick…)
npm test         # unit tests for parsing, categorising, generation, suggestions
```

## What it does

- **Import**: CSV / TSV / TXT / JSON, or paste. Columns are detected from headers (Song, Singer, Lang, Genre…); plain lists such as `1. Amazing Grace - John Newton` work too. Duplicates are detected.
- **Auto-categorise**: language from script (Tamil, Malayalam, Hindi, Korean…) and word hints (Spanish, Hindi transliteration…); genre/theme and tempo from title keywords. Guesses are flagged *check* until you confirm them.
- **Generate**: choose how many songs, filter by language / genre (include or exclude) / tempo, balance languages, prefer songs not sung lately, skip the last N services, cap songs per artist, order lively → quiet. Lock, swap or reorder individual songs.
- **Suggestions**: pairs with the current set, fills gaps (missing language / no slow song), forgotten songs, church-season picks (Advent, Lent, Easter, Pentecost…), theme search.
- **Share**: copy, WhatsApp, share link (read-only view), print, full-screen Present mode.
- **History**: mark a set as sung; Selah avoids repeats and shows what you sing most.
- **Library**: search, filter, bulk edit, favourites, backup/restore.

Not yet built: spreadsheet (`.xlsx`) upload (export to CSV first), lyrics/chords, multi-device sync.
