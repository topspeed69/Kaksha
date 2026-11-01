# Lumen · AI classroom

Lumen turns a topic or a document into a narrated, animated lecture: slides, a whiteboard the AI
draws on step by step, and quizzes graded against a rubric.

```
topic / paper / link / notes
  → ingest (parse, sections, chunks, index)
  → plan (depth, time budget, background)   → you review and edit the outline
  → scenes (slide | whiteboard | quiz), validated, with one repair pass
  → narration (Kokoro speech, cached, real durations)
  → one lesson document → the player
```

## Run it

```bash
npm install
cp .env.example .env          # DATABASE_URL points at your local Postgres
npx drizzle-kit push          # create the tables
npm run build && npm start    # http://localhost:3000
# or, while developing
npm run dev
```

The first request seeds the reference course ("Quantum decoherence and the classical world"), a hand
authored lesson with slides, a whiteboard derivation and a quiz, so there is something to play
immediately.

## Configure models (Settings → 01 Models)

| Task | What it writes | Suggested model |
|---|---|---|
| Default | Used whenever a task has no model of its own | any |
| Planner | The outline and objectives | small and cheap is fine |
| Content | Slides, whiteboard steps, quizzes | the strongest model you have |
| Grader | Marks short answers and derivations | a model with structured output |
| Tutor | Answers questions while you watch | any |

Providers: **OpenAI-compatible** (OpenAI, OpenRouter, DeepSeek, LM Studio, Gemini's compat endpoint,
Ollama's `/v1`), **Anthropic**, and **Ollama native** (`/api/chat` with `format: "json"`).

Local Ollama example: provider `Ollama (local)`, base address `http://127.0.0.1:11434`, model
`llama3.2`. Local addresses are allowed for providers only — never for material links.

With **no model configured**, Lumen still runs end to end: the outline, scenes and quizzes are
drafted from your material by the built-in planner and writer, and short answers are marked by
keyword comparison with the reference answer. Every such course says so on the plan screen, and the
grader tells you its confidence is low. Nothing pretends to be model output.

## Speech

* `Captions only` (default): narration is shown as captions, timed from the text at 150 words per
  minute.
* `Kokoro over HTTP`: point Lumen at a Kokoro service that exposes an OpenAI-compatible
  `/v1/audio/speech`, for example [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)
  (`docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`), then set the address to
  `http://127.0.0.1:8880/v1/audio/speech`. Segments are cached by content hash, so nothing is
  synthesised twice, and the real duration is read from the encoded file.

## Layout

```
src/app            routes (library, create, plan, generating, lecture, whiteboard, quiz, settings)
src/app/api        JSON + SSE endpoints
src/components     ui primitives, player, slides, whiteboard, quiz
src/lib/dsl        the lesson format and its validator (single source of truth)
src/lib/player     computeSceneState, the clock and the player store
src/server         providers (llm, tts), ingest, prompts, pipeline, grading, settings
tests              vitest suites (DSL, player, grading)
```

## Tests

```bash
npx vitest run          # DSL validation, fixture, player state, grading
npx next typegen        # route types
npm exec tsc -- --noEmit
npm run lint
```

## Troubleshooting

* **"No language model is configured"** — Settings → 01 Models, then use *Test connection*. The
  reply time you see is a real round trip.
* **A scene failed** — the Generating screen shows the reason and a Retry button; only that scene is
  re-run.
* **A PDF produced no text** — it is probably a scan. Lumen tells you in the file card; run OCR
  before uploading.
* **Everything looks unstyled after a theme change** — reload once; the theme is stored per browser.
