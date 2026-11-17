# Board Dev — notes for Claude

**This repo is the development copy of Board** (github.com/nzimmer-apps/board is the live one). It has its own
Supabase project, its own app ids ("Board Dev", `com.nzimmerapps.board.dev`, hotkey Ctrl+Alt+D) and its own Pages
site, so it can be installed next to the real app and broken freely. Features are tried here first, then ported to `board`.

Personal capture board (MindChuk-style): notes, `#tag` categories, natural-language dates → calendar,
images with on-device OCR (tesseract.js), and per-note notification times.

## Layout

| Path | What | Built / shipped by |
| --- | --- | --- |
| `web/` | React + Vite + TypeScript app. Every other client wraps or mirrors it | `.github/workflows/pages.yml` → GitHub Pages (https://nzimmer-apps.github.io/board-dev/) |
| `android/` | Capacitor 7 wrapper of `web/` (share-sheet intent, local notifications) | `apps.yml` → `Board-android.apk` |
| `src-tauri/` | Tauri 2 Windows app (tray, Ctrl+Alt+B quick-add, notifications) | `apps.yml` → `Board-windows-setup.exe`, `Board-windows.msi` |
| `extension/` | Chrome/Arc MV3 extension, plain JS, talks to Supabase REST directly | `apps.yml` → `Board-extension.zip` |
| `supabase/migrations/` | Postgres schema, one timestamped file per change | `npx supabase db push` (by hand) |

Backend: Supabase project ref `isznsbnczhpomrdvvzom`. The URL and publishable key are in
`web/.env.production` and `extension/config.js`. They're public by design, because RLS limits every row to its owner.
Never commit an `sb_secret_…` key.

## Build each target

- Web: `cd web && npm ci && npm test && npm run build` (`build` = `tsc --noEmit && vite build`). Dev server: `npm run dev`.
- Android: `cd web && npm run build && npx cap sync android`, then `cd android && ./gradlew assembleRelease`.
  Release signing reads `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS=board` from the environment.
- Windows: `cd web && npm run build`, then from the repo root `npx --prefix web tauri build` (needs Rust).
- Extension: no build. Load `extension/` unpacked.

## Release flow

1. Push to `main`. A change under `web/`, `android/`, `src-tauri/` or `extension/` triggers `apps.yml`
   (or run `gh workflow run apps.yml`).
2. `apps.yml` builds the APK (only if the signing secrets exist), the Windows installers and the extension zip,
   then publishes the GitHub release `v0.2.<run number>` marked as latest.
3. `pages.yml` deploys the web app on pushes that touch `web/`.
4. `ci.yml` runs web tests + typecheck on every pull request.

Signing secrets in GitHub: `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` (alias `board`).
The local copy lives outside the repo in `%USERPROFILE%\.board-signing\`. Never commit, print or paste signing
material. `.gitignore` covers `*.jks`, `*.keystore` and `*KEYSTORE*.txt`.
On Windows PowerShell 5.1, don't pipe a value into `gh secret set` (it appends CRLF). Redirect a
no-newline file through cmd instead: `cmd /c "gh secret set NAME -R nzimmer-apps/board-dev < file"`.

## What dev adds on top of Board

- Repeating items: `items.repeat` (jsonb rule) + `web/src/repeat.ts`. `due_at` is the first occurrence; later ones are computed.
- Parser (`web/src/parse.ts`): `parseAll` returns several items for "6 pm sundays, 7 pm monday and thursdays", and
  reads "notify 2 hours and 8 hours before" into notification times.
- Attachments: voice notes and PDFs in the private `files` bucket (`web/src/files.ts`); text found in a screenshot
  or PDF that contains a date opens `EventPrompt` rather than silently creating an event.
- Voice notes and audio files are turned into text: live in Chrome/Edge while recording, otherwise afterwards on the
  device with Whisper (`web/src/transcribe.ts` + `transcribe.worker.ts`, transformers.js, `Xenova/whisper-base.en`
  downloaded from huggingface.co on first use, then cached). `web/src/voice.ts` reads the words: a day **and** a time
  books the note straight onto the calendar (toast with Undo); a day alone opens `EventPrompt`.
- Event links: `supabase/functions/unfurl` (edge function, signed-in users only) reads a page's title and schema.org
  event data. Deploy with `npx supabase functions deploy unfurl`. It identifies itself honestly and does not log in
  anywhere, so pages behind a login (many Facebook events) come back without a date and the app asks for one.
- Archive screen, Tags screen (`rename_tag` / `delete_tag` SQL functions, colours in `categories`), themes
  (`web/src/theme.ts` + `features.css`), export (`web/src/export.ts`).
- Sharing: `shares` table (one note or one tag, with a person by confirmed email or a read-only secret link).
  RLS on `items` / storage reads it through `share_access()`; people's own lists filter `user_id` so shared notes only
  show under the Shared tab. Links open through the `shared` edge function (deploy with verify_jwt off).
- The first three migrations here were applied to the dev project through the Supabase dashboard API, so its
  migration history uses different version numbers than the files. They are idempotent; `supabase db push` may ask
  to re-apply them, which is safe.
- `web/.env.local` (git-ignored) holds a test account for the dev database, for local testing only.

## Rules

- **Schema changes = a new file in `supabase/migrations/` + `npx supabase db push`.** Never edit an
  applied migration, and never change the schema by hand in the SQL editor. Name files
  `YYYYMMDDHHMMSS_description.sql` (`npx supabase migration new <description>` creates one).
  One-time setup on a new machine: `npx supabase login`, then `npx supabase link --project-ref isznsbnczhpomrdvvzom`.
- `extension/parse.js` is generated from `web/src/parse.ts`: run `npm run build:ext` in `web/` after changing the parser. Parser tests live in `web/src/parse.test.ts`.
- `keepalive.yml` calls `public.ping()` daily so the free Supabase project doesn't pause. Don't drop that function.
