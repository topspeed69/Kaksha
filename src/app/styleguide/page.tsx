/* The styleguide renders the interactive primitives themselves, so it is a
   client component. Everything it shows is also used in the real screens. */
"use client";

import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  KeyboardHint,
  LinkButton,
  NumberedSection,
  ProgressRule,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  StatusLabel,
  Tag,
  TextArea,
  TextInput,
} from "@/components/ui";

export default function StyleguidePage() {
  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-12">
        <h1 className="type-display text-ink">Styleguide</h1>
        <p className="type-body-lg measure mt-4 max-w-[56ch] text-muted">
          Every primitive in one place. Values come from the design export: off-white canvas, carbon
          ink, one signal red, 1px rules, no shadows, 0px corners.
        </p>
      </div>

      <div className="col-span-4 mt-10 lg:col-span-12">
        <NumberedSection index="01" title="Type scale" />
        <div className="mt-4 space-y-4 border-y border-rule py-6">
          <p className="type-display text-ink">Display 44/56</p>
          <p className="type-h1 text-ink">Heading one 32</p>
          <p className="type-h2 text-ink">Heading two 24</p>
          <p className="type-h3 text-ink">Heading three 20</p>
          <p className="type-body-lg measure max-w-[60ch] text-ink">
            Body large 18/28. Flush left, ragged right, and never wider than seventy characters.
          </p>
          <p className="type-body measure max-w-[60ch] text-muted">
            Body 16/24 in the secondary colour. Metadata sits one step quieter than the argument.
          </p>
          <p className="type-label text-muted">Label 11 · letterspaced · uppercase</p>
          <p className="type-num text-accent">01 02 03 · tabular numerals</p>
        </div>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-6">
        <NumberedSection index="02" title="Buttons and links" />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button variant="primary">Plan my course</Button>
          <Button variant="secondary">Review plan</Button>
          <Button variant="ghost">Change depth</Button>
          <LinkButton href="/library" variant="secondary">
            Library
          </LinkButton>
        </div>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-6">
        <NumberedSection index="03" title="Status and tags" />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <StatusLabel status="ready" />
          <StatusLabel status="generating" current={7} total={12} />
          <StatusLabel status="archived" />
          <StatusLabel status="failed" />
          <Tag>Quiet tag</Tag>
          <Tag tone="outline">Outline tag</Tag>
          <Tag tone="accent">Accent tag</Tag>
        </div>
        <div className="mt-4 w-64">
          <ProgressRule value={7} max={12} />
        </div>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-12">
        <NumberedSection index="04" title="Controls" />
        <div className="mt-4 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          <SegmentedControl
            name="Depth"
            value="undergraduate"
            onChange={() => undefined}
            options={[
              { value: "introductory", label: "Introductory" },
              { value: "undergraduate", label: "Undergraduate" },
              { value: "graduate", label: "Graduate" },
            ]}
          />
          <Slider
            label="Time available"
            min={15}
            max={90}
            step={5}
            value={45}
            onChange={() => undefined}
            ticks={[15, 30, 45, 60, 90]}
            suffix="min"
          />
          <Select
            label="Voice"
            value="captions"
            onChange={() => undefined}
            options={[{ value: "captions", label: "Captions only" }]}
            hint="Voices come from the speech service."
          />
          <div className="space-y-4">
            <Checkbox checked onChange={() => undefined} label="Derive formal results" />
            <Checkbox checked={false} onChange={() => undefined} label="Embed citations" />
          </div>
        </div>
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <Field label="Topic" hint="One or two sentences works best." counter={<span className="type-label-sm text-muted">0 / 400</span>}>
            <TextArea rows={3} placeholder="For example: quantum decoherence" />
          </Field>
          <Field label="Link" hint="Fetched once, on the server.">
            <TextInput placeholder="https://…" type="url" />
          </Field>
        </div>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-6">
        <NumberedSection index="05" title="States" />
        <div className="mt-4 space-y-6">
          <EmptyState
            title="No courses yet"
            body="Start from a topic, a paper or your own notes. The plan is editable before anything is generated."
          />
          <div>
            <p className="type-label text-muted">Loading</p>
            <div className="mt-3">
              <Skeleton rows={4} />
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-6">
        <NumberedSection index="06" title="Keyboard" />
        <div className="mt-4">
          <KeyboardHint
            items={[
              { keys: "Space", action: "Play or pause" },
              { keys: "← →", action: "10 seconds" },
              { keys: "Shift ← →", action: "Scene" },
              { keys: "C", action: "Captions" },
              { keys: "[ ]", action: "Speed" },
              { keys: "F", action: "Fullscreen" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
