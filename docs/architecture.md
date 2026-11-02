# Architecture

## One process, one contract

Kaksha runs as a single Next.js application. Server-only code lives in `src/server`; nothing there
is imported by a client component. The API surface described in the product brief is implemented as
route handlers under `src/app/api`, and generation runs as in-process background work — no queue, no
second service.

The contract between the generator and the player is `src/lib/dsl`:

- `types.ts` — the lesson format, version 1.
- `validate.ts` — every rule the generator must satisfy, plus the duration and timing helpers.

Both sides import the same module, so the two cannot drift.

```
topic / paper / link / notes
  → ingest        src/server/ingest     parse → sections → chunks → embeddings
  → plan          src/server/pipeline/planner.ts   interrupt for review
  → scenes        src/server/pipeline/scenes.ts    generate → validate → repair
  → narration     src/server/providers/tts.ts      cached by content hash
  → lesson        src/lib/dsl/types.Course         → the player
```

## Data model

Tables (Drizzle schema in `src/db/schema.ts`):

| Table | Holds |
|---|---|
| `settings` | one row: model slots, speech service, appearance |
| `materials` | parsed source: sections, counts, warnings, status |
| `chunks` | ~500-900 token pieces with section/page references and an embedding |
| `courses` | the plan, the assembled lesson document, depth, voice, status |
| `scenes` | one row per planned scene, with status, JSON and error |
| `audio` | one row per synthesised file: hash, duration, voice, speed |
| `progress` | where the learner stopped in a course |
| `quiz_attempts` | every answer, marked or draft |
| `jobs` | background generation state so work can resume |

Course status moves `planning → plan_ready → generating → ready`, plus `failed` and `archived`.
Scene status moves `pending → generating → ready | failed`.

## The player is a pure function of time

`src/lib/player/computeSceneState.ts` maps `(scene, tMs, speed)` to the exact visual state: which
slide elements are revealed, which is spotlighted, which whiteboard objects are drawn and how far
each stroke has progressed, which step is current.

Because state is computed rather than accumulated, seeking anywhere, replaying a step, changing speed
and resuming after a refresh are all correct by construction — there are no timers that have to be
replayed to know what the board looks like.

One clock drives everything: a single `<audio>` element when the current segment has a file (the
virtual clock is set from its `timeupdate`), or one interval when it does not.

## Generation

1. `POST /courses` creates a row in `planning` and starts planning.
2. `runPlanning` retrieves source chunks, asks the planner slot for a JSON outline, falls back to
   the built-in planner, fits the plan to the time budget, and stores it. The course then sits in
   `plan_ready` until the learner approves it.
3. `POST /courses/{id}/generate` creates scene rows and starts generation, two scenes at a time.
4. Each scene: retrieve top-k chunks → generate → validate → repair → persist → synthesise narration.
   A scene that still fails validation is marked `failed` with its error; nothing else is affected.
5. `GET /courses/{id}/events` streams `step`, `scene_ready`, `scene_failed` and `done` with real
   counts, taken from the database rather than from an in-memory counter.

**Resuming.** `bootstrap()` runs once per process: it seeds the reference course and re-reads any
course still marked `generating`, so work interrupted by a restart continues. Scene generation is
idempotent — a scene that is already `ready` is never regenerated, and narration is cached by
content hash, so restarting never repeats finished work.

## Speech

`TTSProvider` has two implementations: `KokoroHttpProvider` (an OpenAI-compatible
`/v1/audio/speech` endpoint) and `NoSpeechProvider` (captions only, timed from the text).

Cache key: `sha256(provider | voice | speed | normalised text)`. Duration is read from the encoded
file (an MP3 frame walk, or a WAV header) rather than estimated. Segments are short — one to three
sentences — so sync stays fine-grained.

## Security and privacy

- Single-user local app. Keys are stored encrypted (AES-256-GCM, key from `KAKSHA_SECRET_KEY` or a
  generated file in `storage/`) and are never returned to the browser or logged.
- URL ingestion is SSRF-guarded: the hostname is resolved and private, loopback and link-local
  ranges are refused, and redirects are re-checked. That exception is *not* applied to material.
- Uploads are size-limited, sniffed by content, stored under random names, and never served raw.
- Material and student answers are treated as data inside every prompt; no tools are exposed to
  models in v1.
- Plot expressions are evaluated in a whitelisted scope (`x`, `pi`, `e` and a short list of maths
  functions) after an AST check.
- KaTeX renders with `trust: false` and no macros; it is the only HTML injected into the page.
