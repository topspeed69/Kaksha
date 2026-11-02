# Decisions

One line each: decision, why.

- **Single Next.js app instead of a separate Python FastAPI service.** The deployment target for
  this build is a managed Next.js + PostgreSQL runtime; a second Python process could not be built,
  started or health-checked there. The DSL, providers, pipeline and grading live in `src/server`,
  and every contract the brief put under `/api` exists as a Next.js route handler.
- **TypeScript DSL in `src/lib/dsl` as the single source of truth** instead of Pydantic + generated
  types; generation and the player import the same module, so drift is impossible by construction.
- **PostgreSQL via Drizzle instead of SQLite + SQLModel/Alembic**, matching the managed runtime.
  The schema is the one in section 5 of the brief.
- **In-process background generation with a `jobs` table and a lazy resume pass** instead of
  LangGraph with a checkpointer. Node has no LangGraph equivalent here; the resume guarantee the
  brief asks for (survive a restart, continue pending scenes) is met by re-reading course/scene
  state on the first request after a restart.
- **Lexical keyword index instead of FAISS** when no embedding model is configured. Vectors are
  stored with each chunk and compared by cosine; with Ollama or an API embedding model configured,
  real embeddings are used. The UI calls the fallback a keyword index.
- **`unpdf` for PDF text extraction** and `jszip` for EPUB, both pure JS and safe inside the server
  runtime. Math-aware extractors (Marker/MinerU) are out of scope for v1 and the parser interface
  allows them later.
- **Narration timing from the text when no speech service is configured.** Durations come from the
  word count at 150 words per minute and are labelled as estimates; when Kokoro audio exists the
  duration is read from the encoded file (MP3 frame walk / WAV header) and used instead.
- **Optional browser speech as a narration mode** so the lesson can be heard without a speech
  service. It is a toggle in the lecture view, not a claim of synthesised audio.
- **`format: "json"` for Ollama rather than a JSON Schema `format` object**, because that is what the
  current Ollama `/api/chat` accepts for structured output; the schema is described in the prompt.
- **Anthropic has no JSON mode, so the assistant turn is prefilled with `{`** and the reply is
  rejoined before parsing.
- **The player clock is a pure function of time** (`computeSceneState`) with a single `<audio>`
  element as master clock when a segment has a file, and a requestAnimationFrame clock otherwise.
  Seeking, replaying a step and changing speed are correct by construction.
- **Grader never computes the total.** Criterion scores come back from the model; the weighted total
  is computed server-side. Choice questions are marked deterministically in code.
- **Draft feedback without a model** is an honest checklist of key points, not a fake score.
- **Fixture course is hand authored and says so** (`generator.label`), so nothing in the UI implies a
  model wrote it.
- **Numbered sections, hairlines and one red** are taken from the Stitch export; copy follows the
  brief's plain-language list, so none of the export's banned labels (SYS codes, archive 2.0,
  coordinate grids, proof counts, confidence percentages) appear.
- **Vitest instead of Playwright for this pass.** E2E at two viewports needs a running browser stack
  that is not available here; the player, whiteboard and grading logic are covered by unit tests,
  and every screen is responsive by construction.
- **`serverExternalPackages: ["pg"]` in next.config.ts.** Turbopack rewrites pg's optional
  `pg-native` require into a hashed external (`pg-<hash>`) that Node cannot resolve, which broke
  `npm run dev` with "Cannot find package 'pg-…'". Keeping pg external makes the server require the
  real package; verified by booting dev and exercising every DB-backed route.
- **Fonts are self-hosted from @fontsource packages via next/font/local.** next/font/google failed
  under Turbopack in the sandbox build; local files keep the brief's "no CDN hotlinking" rule and
  make builds hermetic.
- **drizzle.config.ts reads DATABASE_URL from the environment** (fallback to the local default) so a
  fresh clone works from .env alone.
- **Topic-only quizzes get fallback key points** (the objective plus a consistency point) when there
  are no source chunks; the validator requires at least one checkable key point, and without this the
  quiz scenes of material-less courses always failed. Regression-tested.
- **TTS preview is served from the audio cache on disk**, not by fetching the app's own HTTP port.
- **Canonical IPv6/IPv4 SSRF guard + `checkProviderUrl`.** IPv6 literals are parsed into 8 uint16
  groups so expanded loopback, IPv4-mapped (`::ffff:…`), 6to4 (`2002::/16`), NAT64 (`64:ff9b::/96`),
  unique-local and link-local ranges cannot bypass string checks. Provider URLs allow private LAN /
  loopback only when `KAKSHA_ALLOW_LOCAL_PROVIDERS=1`, and cloud metadata ranges (`169.254.0.0/16`,
  `fe80::/10`) are blocked unconditionally.
- **Whitelisted, LRU-compiled MathJS plot evaluator.** `checkPlotExpression` restricts AST node
  types and depth (`<= 120` nodes) and `safeEvaluate` compiles validated expressions once into a
  256-entry LRU cache (>50x faster per frame, immune to matrix/range allocation DoS).
- **Write-only secret mask preservation.** `mergeSettings` treats `"••••••••"` and `""` as "keep
  stored key" and `"__CLEAR__"` as explicit deletion, preventing Settings re-saves from overwriting
  encrypted API keys with bullet characters.
- **Batched queries and chunk inserts.** `listCourses` fetches scenes, attempts and progress in one
  parallel batch instead of `1 + 2N` sequential queries; `getCourseDetail` deduplicates queries;
  material ingestion embeds with bounded concurrency and batch-inserts chunks.
- **Optional `ACCESS_CODE` gate and origin restriction in `src/proxy.ts`.** Single-user local mode
  by default; setting `ACCESS_CODE` gates UI and API routes with a constant-time HMAC-SHA256 signed
  HttpOnly cookie while keeping `/api/health` open, and mutating `/api/*` requests reject mismatched
  `Origin` headers.
- **Thin server, thick client player.** Lecture and Whiteboard are client-rendered from an
  IndexedDB course cache first, then revalidated through `/api/courses/{id}/player`. Generation
  progress uses SSE plus a metadata-only status fallback instead of downloading the full course.
- **Prepared scene indexes.** Timelines, sorted action schedules, slide/whiteboard snapshots and
  step ranges are built once per scene object; playback seeks use binary search and stable snapshot
  identities so completed SVG strokes and KaTeX elements do not re-render on every clock tick.
- **Pinned-IP safe fetch.** Material and provider requests use a Node HTTP client whose DNS lookup
  revalidates addresses at connection time, closing the check-then-fetch DNS rebinding window.
- **Reserved-region slide layout.** Inspired by OpenMAIC's separation of playback actions from a
  dedicated slide renderer, Kaksha assigns heading/math/figure/body/callout to fixed grid regions and
  fits each region's content, so equations, graphs and text cannot overlap.
- **Fullscreen targets the lecture player.** The fullscreen button and F key request fullscreen on
  the stage + captions + transport container, not the whole document.
- **Automatic browser speech fallback.** Narration defaults to `auto`: cached file audio when
  present, otherwise the browser's default English voice via speechSynthesis, with captions always
  available. Users can force browser voice or captions only.
- **Focus camera.** Inspired by OpenMAIC's spotlight/laser-over-element-geometry model, Kaksha adds a
  camera that pans and zooms to whatever is being explained. Slide geometry is measured with
  transform-immune `offset*` properties (measuring with `getBoundingClientRect` would feed the
  camera's own transform back into its input); whiteboard geometry is precomputed from canvas
  coordinates at prepare time. The laser is drawn above the camera layer at a fixed size and its
  position is pushed through the camera transform, so it keeps pointing at the right spot while zoomed.
- **Transient attention cues.** Spotlight, laser and whiteboard highlight expire after
  `HIGHLIGHT_WINDOW_MS` (1.6 s) of media time, computed as pure functions of time so seeking stays
  correct. Cues that linger stop reading as "the teacher is pointing here now"; this also avoids the
  spotlight-flashing problem OpenMAIC reports in its own issue tracker. Equations keep the accent
  colour highlight while focused.
- **Browser speech fallback.** `speechSynthesis` is driven without a synchronous `cancel()` before
  `speak()` (Chrome drops an utterance queued in the same task as the cancel), keeps a strong
  reference to the utterance to prevent mid-speech GC, warms the asynchronously loaded voice list,
  and has a 2.2 s watchdog that hands the clock back to the virtual timeline if no voice starts.
  While speech is narrating, its own `onend` advances the segment so narration and captions stay in
  step instead of drifting against a text estimate.
- **Mute.** `M` and a transport button mute both file audio and browser speech; captions keep
  running so the lecture remains followable.
- **Collapsible Models section in Settings.** Section 01 collapses so Speech and Appearance are
  reachable without a long scroll; state is per-visit and defaults to open.
