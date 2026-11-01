# Changelog

## 0.1.0

First working build.

- Swiss Modernism 2.0 design system with a `/styleguide` page, light and dark themes.
- Lesson format (DSL) v1 with a validator: slide word limits, bullet limits, action targets,
  whiteboard canvas bounds and label overlap, plot-expression whitelist, rubric weights.
- Player: global timeline per scene, `computeSceneState` as a pure function of time, captions,
  transport with scene markers, transcript, module track, keyboard shortcuts, progress persistence.
- Whiteboard: all `wb.*` ops, KaTeX typesetting, safe plotting via mathjs, step list, replay step,
  controls directly under the canvas.
- Quiz: all four question types, deterministic marking for choices, rubric grading for short answers
  and derivations, draft feedback, result view with covered/missing points.
- Library, Create, Course plan, Generating, Settings screens with real data and real states.
- Generation pipeline: plan → review → scenes (validated, one repair pass) → narration → ready, with
  SSE progress, per-scene retry and resume after a restart.
- Ingestion: PDF, EPUB, Markdown, plain text, URL (SSRF-guarded), chunking with overlap, keyword or
  model embeddings, retrieval used to ground scenes and attach sources.
- Hand authored reference course on quantum decoherence (9 scenes, 2 modules).
