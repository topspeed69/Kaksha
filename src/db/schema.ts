import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  Course,
  CoursePlan,
  GradeResult,
  GenerationOptions,
  QuizAnswer,
  Scene,
  Segment,
  SourceKind,
} from "@/lib/dsl/types";

/** Single-row settings table (id = 1). Secrets are stored encrypted. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").notNull().default({}),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<SourceKind>().notNull(),
    label: text("label").notNull(),
    path: text("path"),
    url: text("url"),
    status: text("status").notNull().default("parsing"),
    section_count: integer("section_count").notNull().default(0),
    chunk_count: integer("chunk_count").notNull().default(0),
    pages: integer("pages"),
    bytes: integer("bytes"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    sections: jsonb("sections")
      .$type<{ title: string; level: number; text: string; page?: number }[]>()
      .notNull()
      .default([]),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("materials_status_idx").on(t.status)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    material_id: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    text: text("text").notNull(),
    page: integer("page"),
    section_ref: text("section_ref"),
    tokens: integer("tokens").notNull().default(0),
    embedding: jsonb("embedding").$type<number[] | null>(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chunks_material_idx").on(t.material_id, t.ord)],
);

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    topic: text("topic"),
    status: text("status").notNull().default("planning"),
    depth: text("depth").notNull().default("undergraduate"),
    background: text("background").notNull().default("familiar"),
    minutes_target: integer("minutes_target").notNull().default(30),
    voice_id: text("voice_id").notNull().default("af_heart"),
    voice_speed: real("voice_speed").notNull().default(1),
    options: jsonb("options")
      .$type<GenerationOptions>()
      .notNull()
      .default({ derive_proofs: true, embed_citations: true }),
    source_kind: text("source_kind").$type<SourceKind>().notNull().default("topic"),
    source_label: text("source_label").notNull().default("your topic"),
    material_ids: jsonb("material_ids").$type<string[]>().notNull().default([]),
    plan: jsonb("plan").$type<CoursePlan | null>(),
    document: jsonb("document").$type<Course | null>(),
    generator_label: text("generator_label").notNull().default("Not generated yet"),
    modelled: boolean("modelled").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    last_opened_at: timestamp("last_opened_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("courses_status_idx").on(t.status)],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    module_id: text("module_id").notNull(),
    index: integer("index").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("pending"),
    json: jsonb("json").$type<Scene | null>(),
    plan_intent: text("plan_intent"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("scenes_course_index_idx").on(t.course_id, t.index)],
);

export const audio = pgTable(
  "audio",
  {
    hash: text("hash").primaryKey(),
    path: text("path").notNull(),
    duration_ms: integer("duration_ms").notNull(),
    voice: text("voice").notNull(),
    speed: real("speed").notNull(),
    bytes: integer("bytes").notNull().default(0),
    mime: text("mime").notNull().default("audio/mpeg"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const progress = pgTable(
  "progress",
  {
    course_id: uuid("course_id")
      .primaryKey()
      .references(() => courses.id, { onDelete: "cascade" }),
    scene_index: integer("scene_index").notNull().default(0),
    t_ms: integer("t_ms").notNull().default(0),
    scenes_done: jsonb("scenes_done").$type<number[]>().notNull().default([]),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    question_id: text("question_id").notNull(),
    answer: jsonb("answer").$type<QuizAnswer>().notNull(),
    result: jsonb("result").$type<GradeResult | null>(),
    final: boolean("final").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("quiz_attempts_question_idx").on(t.question_id, t.final)],
);

/** Background generation jobs. State survives restarts so work can resume. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("generate"),
    state: text("state").notNull().default("running"),
    step: text("step").notNull().default("planning"),
    current: integer("current").notNull().default(0),
    total: integer("total").notNull().default(0),
    error: text("error"),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("jobs_state_idx").on(t.state)],
);

/** Narration segments cache: maps segment text to synthesised audio hash. */
export const narrationSegments = pgTable("narration_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  course_id: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  scene_index: integer("scene_index").notNull(),
  segment: jsonb("segment").$type<Segment>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MaterialRow = typeof materials.$inferSelect;
export type CourseRow = typeof courses.$inferSelect;
export type SceneRow = typeof scenes.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ChunkRow = typeof chunks.$inferSelect;
