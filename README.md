# Sabboura

A personal drive where every file is a live whiteboard. You get folders, stars, recent files, trash and search, like Google Drive. Each file opens as an [Excalidraw](https://excalidraw.com) canvas that stays in sync in real time across all your devices and tabs.

- **Drive:** nested folders, drag-and-drop moving, star, rename, duplicate, trash/restore, search, grid or list view, live thumbnails.
- **Live boards:** edits, cursors and selections stream between every device that has the board open. Changes save automatically, and the drive view updates live too.
- **Conflict-safe saving:** concurrent saves merge per element, so two devices editing at once can't overwrite each other.
- **Images:** pasted or dropped images sync to every open device.
- **Import/export:** import `.excalidraw` files, export PNG, SVG or `.excalidraw`.
- **Light/dark themes, mobile layout.**

## How it works

```
Browser (Next.js app, Excalidraw)
   │  auth, Postgres (drive + scenes), Realtime
   ▼
Supabase
   ├─ items          folders + boards (tree via parent_id), RLS per user
   ├─ board_scenes   Excalidraw elements / images per board
   ├─ save_board_elements()  merge-on-save (highest element version wins)
   └─ Realtime       private "board:<id>" channels for deltas, cursors, presence;
                     postgres_changes on items for the live drive
```

Vercel serves the Next.js app. All real-time traffic goes over Supabase Realtime, because Vercel functions can't hold WebSockets open. Data is protected by row-level security. Each board's realtime channel is private, and only the board's owner can join it.

**Local mode.** If no Supabase keys are set, Sabboura runs entirely in the browser: data goes to `localStorage` and tabs sync over `BroadcastChannel`. This is handy for trying it out, but nothing syncs across devices.

## Deploy

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is fine).
2. In **SQL Editor**, paste and run [`supabase/migrations/20261004000000_init.sql`](supabase/migrations/20261004000000_init.sql). It is idempotent, so re-running it after updates is safe.
3. In **Authentication → URL Configuration**:
   - set **Site URL** to your Vercel URL, e.g. `https://sabboura.vercel.app`;
   - add `https://*.vercel.app/**` and `http://localhost:3000/**` to **Redirect URLs** if you want preview deployments and local development to work.
4. Copy the **Project URL** and **anon/publishable key** from **Settings → API**.

> **Keep it personal:** after you create your account, turn off **Authentication → Sign In / Providers → Allow new users to sign up**. RLS already keeps every user's data separate, so this only stops strangers from creating accounts.

### 2. Vercel

1. Import this repository in Vercel. The framework is detected as Next.js, with no build settings to change.
2. Add these environment variables (Production, Preview and Development):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon/publishable key |

   The Vercel ↔ Supabase marketplace integration sets these for you, if you use it.
3. Deploy, open the site, and choose **Sign up**.

## Develop

```bash
npm install
cp .env.example .env.local   # optional: fill in Supabase keys, or leave empty for local mode
npm run dev                  # http://localhost:3000
```

| Script | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build (also copies Excalidraw fonts into `public/fonts`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |

### Code map

| Path | |
| --- | --- |
| `src/lib/backend/` | storage + realtime interface with a Supabase implementation and a local one |
| `src/components/board/sync.ts` | `BoardSync`: delta broadcast, reconcile, throttled save, images, thumbnails, cursors |
| `src/components/board/` | board page and the Excalidraw editor |
| `src/components/drive/` | drive shell (sidebar, search, dialogs) and the file views |
| `supabase/migrations/` | tables, RLS, merge function, realtime policies |

### Sync model

- Each tab diffs the scene by element `version` and broadcasts only the changed elements.
- Peers merge incoming elements with Excalidraw's `reconcileElements`.
- When a new device joins, open tabs send it their current scene. After a reconnect, a tab re-reads the database and re-broadcasts.
- The tab that made an edit saves it, at most once per second. The server merges the save by element version, so concurrent saves are safe. Deleted elements stay as tombstones for 24 hours so offline devices learn about the deletion.
- Images are stored once per board, and peers are told to fetch them.
