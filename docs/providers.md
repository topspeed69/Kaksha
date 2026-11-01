# Providers

Lumen talks to models and speech engines through small interfaces, so anything that speaks the
protocol can be swapped in from Settings.

## Language models

One interface, four implementations (`src/server/providers/llm.ts`):

| Provider | Endpoint | Structured output |
|---|---|---|
| OpenAI compatible | `POST {base}/chat/completions` | `response_format: { type: "json_object" }` |
| NVIDIA NIM | `POST integrate.api.nvidia.com/v1/chat/completions` | `response_format`, retried without it |
| Anthropic | `POST {base}/v1/messages` | assistant turn prefilled with `{` |
| Ollama native | `POST {base}/api/chat` | `format: "json"` |

The OpenAI-compatible entry covers OpenAI, OpenRouter, DeepSeek, LM Studio, Gemini's
compatibility endpoint and Ollama's `/v1`, so you only need that entry plus the right base
address.

### NVIDIA NIM

NVIDIA NIM speaks the OpenAI chat-completions protocol, so it is one entry in the same provider
list. Pick *NVIDIA NIM* in Settings and the base address is set to
`https://integrate.api.nvidia.com/v1`; paste your key from
[build.nvidia.com/settings](https://build.nvidia.com/settings) and a model id such as
`minimaxai/minimax-m3.1-flash`. List the available ids with `GET https://integrate.api.nvidia.com/v1/models`.

Not every model accepts `response_format: { type: "json_object" }`. When a model refuses it the
request is retried once without it, and the reply is parsed for JSON either way, so JSON mode
staying enabled is safe.

### Testing a model

*Test connection* sends what is currently typed in the form, so you can try a model before you
save it. Nothing is written to the database by the test. A real round-trip is made; the latency
and the reply are shown next to the button.

### Task slots

`default`, `planner`, `content`, `grader`, `tutor`. A slot with no model falls back to `default`.
Planner and grader run at low temperature, content and tutor slightly higher.

### The structured output contract

Every generation call asks for JSON:

```
request with schema in the prompt → parse → validate → on failure, one repair call
that includes the validation errors → a second failure marks only that scene failed
```

The repair call repeats the original prompt plus the validation problems, so small local models that
mangle JSON usually succeed on the second try.

### Without a model

Lumen still works end to end. The built-in planner writes the outline from your topic and material,
the built-in writer drafts each scene, and short answers are marked by comparing your words with the
reference answer. Every such course says so on the plan screen, and the grader reports a low
confidence and offers the reference answer. Nothing pretends to be model output.

## Speech

`TTSProvider` (`src/server/providers/tts.ts`):

- **Kokoro over HTTP** — any service exposing an OpenAI-compatible `/v1/audio/speech`. The voice
  list is read from the running service, so the menu shows what the engine really offers.
- **Captions only** — no service needed. Narration is shown as captions, timed from the text at
  150 words per minute.

Before synthesis, a normaliser expands symbols that do not read aloud (`Δ` → "delta", `ħ` → "h-bar",
`≫` → "much greater than"). That is a safety net: narration is written to be spoken in the first
place.

Files are cached by `sha256(provider | voice | speed | normalised text)` and the real duration is
read from the encoded file, never estimated. Identical segments are never synthesised twice.

### Running Kokoro locally

```bash
docker compose --profile kokoro up kokoro     # or the project's own image
```

Then in Settings → Speech choose *Kokoro over HTTP* and set the address to
`http://127.0.0.1:8880/v1/audio/speech`. Local addresses are allowed for providers only; material
links are never fetched from a private range.

## Embeddings and retrieval

Two options:

- **Ollama embeddings** or an **API embedding model**, used when configured.
- **Keyword index** — the default. Vectors are stored per chunk and compared by cosine similarity.

Retrieval runs per scene (top 6 chunks) and grounds generation: each scene lists the chunk ids it
used, and the UI shows them as sources. A scene built from a topic with no material says so rather
than inventing citations.

## Choosing a model per task

| Task | Wants |
|---|---|
| Planner | Reliable JSON, long output, cheap |
| Content | The strongest model you have: it writes narration |
| Grader | Consistent scores; short structured replies |
| Tutor | Fast, streamed, plain prose |
