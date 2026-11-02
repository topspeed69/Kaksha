"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { prefetchCourse } from "@/lib/course-cache";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* --------------------------------- button --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({
  children,
  variant = "secondary",
  type = "button",
  onClick,
  disabled,
  className,
  title,
  full,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  full?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-6 py-3 type-label transition-colors disabled:opacity-40 disabled:pointer-events-none";
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-ink hover:bg-accent-hover",
    secondary: "border border-ink text-ink hover:bg-ink hover:text-bg",
    ghost:
      "border-b border-rule text-ink hover:border-accent hover:text-accent px-0 py-1",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, styles[variant], full && "w-full", className)}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-6 py-3 type-label transition-colors";
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-ink hover:bg-accent-hover",
    secondary: "border border-ink text-ink hover:bg-ink hover:text-bg",
    ghost: "border-b border-rule text-ink hover:border-accent hover:text-accent px-0 py-1",
  };
  return (
    <Link href={href} className={cn(base, styles[variant], className)}>
      {children}
    </Link>
  );
}

/* ---------------------------------- tags ---------------------------------- */

export function Tag({
  children,
  tone = "quiet",
}: {
  children: ReactNode;
  tone?: "quiet" | "accent" | "outline";
}) {
  const tones = {
    quiet: "bg-surface-2 text-muted",
    accent: "bg-accent text-accent-ink",
    outline: "border border-rule text-ink",
  } as const;
  return <span className={cn("type-label px-2 py-1", tones[tone])}>{children}</span>;
}

export function StatusLabel({ status, current, total }: { status: string; current?: number; total?: number }) {
  const label =
    status === "generating" && typeof current === "number" && typeof total === "number"
      ? `Generating ${Math.round((current / Math.max(1, total)) * 100)}%`
      : status === "plan_ready"
        ? "Plan ready"
        : status === "ready"
          ? "Ready"
          : status === "archived"
            ? "Archived"
            : status === "failed"
              ? "Failed"
              : status === "planning"
                ? "Planning"
                : status === "pending"
                  ? "Waiting"
                  : status;
  const tone =
    status === "ready" || status === "plan_ready"
      ? "text-ink"
      : status === "generating" || status === "planning"
        ? "text-accent"
        : status === "failed"
          ? "text-accent"
          : "text-muted";
  return (
    <span className={cn("type-label flex items-center gap-2", tone)}>
      <span
        className={cn(
          "inline-block h-2 w-2",
          status === "ready" || status === "plan_ready"
            ? "bg-ink"
            : status === "failed"
              ? "bg-accent"
              : "bg-accent animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

export function ProgressRule({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="block h-[3px] w-full bg-surface-3">
      <span className="block h-[3px] bg-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}

/* ---------------------------- numbered section ---------------------------- */

export function NumberedSection({
  index,
  title,
  hint,
  aside,
}: {
  index: string;
  title: string;
  hint?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="border-t border-rule pt-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="type-num text-accent">{index}</span>
          <h3 className="type-h3 text-ink">{title}</h3>
        </div>
        {aside}
      </div>
      {hint ? <p className="type-body-sm measure mt-2 text-muted">{hint}</p> : null}
    </div>
  );
}

/* --------------------------- segmented control ---------------------------- */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="flex w-full flex-col border border-rule sm:flex-row"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 border-b border-rule px-4 py-3 text-left last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 transition-colors",
              active ? "bg-ink text-bg" : "bg-bg text-ink hover:bg-surface-2",
            )}
          >
            <span className="type-body-sm block font-medium">{option.label}</span>
            {option.hint ? (
              <span className={cn("type-body-sm block", active ? "text-bg/70" : "text-muted")}>
                {option.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- slider --------------------------------- */

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  ticks,
  label,
  suffix,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  ticks?: number[];
  label: string;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="type-label text-muted">{label}</span>
        <span className="type-h2 text-ink">
          {value}
          <span className="type-body-sm ml-2 text-muted">{suffix}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-[3px] w-full appearance-none bg-surface-3 accent-[var(--accent)] outline-none"
        style={{ accentColor: "var(--accent)" }}
      />
      {ticks ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {ticks.map((tick) => (
            <button
              key={tick}
              type="button"
              onClick={() => onChange(tick)}
              className={cn(
                "type-label-sm min-h-11 border border-rule px-3 py-2 transition-colors md:min-h-0 md:px-2 md:py-1",
                tick === value ? "bg-ink text-bg" : "text-muted hover:text-ink",
              )}
            >
              {tick}
              {suffix ? suffix.toLowerCase() : ""}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- select --------------------------------- */

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="type-label text-muted">
        {label}
      </label>
      <div className="relative mt-2">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className="w-full appearance-none border border-rule bg-bg px-4 py-3 pr-10 text-ink"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={1.5}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      {hint ? <p className="type-body-sm mt-2 text-muted">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------- checkbox -------------------------------- */

export function Checkbox({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        id={id}
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center border transition-colors md:h-5 md:w-5",
          checked ? "border-accent bg-accent text-accent-ink" : "border-rule-strong bg-bg text-transparent",
        )}
      >
        <Check size={14} strokeWidth={2} />
      </button>
      <label htmlFor={id} className="cursor-pointer">
        <span className="type-body block text-ink">{label}</span>
        {description ? <span className="type-body-sm block text-muted">{description}</span> : null}
      </label>
    </div>
  );
}

/* --------------------------------- inputs --------------------------------- */

export function Field({
  label,
  children,
  hint,
  counter,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  counter?: ReactNode;
}) {
  return (
    <div suppressHydrationWarning>
      <div className="flex items-baseline justify-between">
        <span className="type-label text-muted">{label}</span>
        {counter}
      </div>
      <div className="mt-2">{children}</div>
      {hint ? <p className="type-body-sm mt-2 text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full border border-rule bg-bg px-4 py-3 text-ink placeholder:text-muted focus:border-ink",
        props.className,
      )}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full border border-rule bg-bg px-4 py-3 leading-relaxed text-ink placeholder:text-muted focus:border-ink",
        props.className,
      )}
    />
  );
}

/* ------------------------------- data table ------------------------------- */

export function DataTable({
  head,
  children,
  caption,
}: {
  head: string[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-y border-rule">
            {head.map((cell) => (
              <th key={cell} scope="col" className="type-label px-3 py-3 text-muted">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--rule)]">{children}</tbody>
      </table>
      {caption ? <p className="type-body-sm mt-3 text-muted">{caption}</p> : null}
    </div>
  );
}

/* ------------------------------ misc pieces ------------------------------- */

export function KeyboardHint({ items }: { items: { keys: string; action: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {items.map((item) => (
        <li key={item.keys} className="flex items-center gap-2">
          <kbd className="type-label-sm border border-rule px-1.5 py-0.5 text-ink">
            {item.keys}
          </kbd>
          <span className="type-body-sm text-muted">{item.action}</span>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-rule bg-surface px-6 py-12">
      <h3 className="type-h2 text-ink">{title}</h3>
      <p className="type-body measure mt-3 max-w-[52ch] text-muted">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-8 border-b border-rule bg-surface-2"
          style={{ width: `${88 - index * 9}%` }}
        />
      ))}
    </div>
  );
}

/* --------------------------------- toast ---------------------------------- */

type ToastEntry = { id: number; message: string; tone: "info" | "error" };
const ToastContext = createContext<(message: string, tone?: "info" | "error") => void>(
  () => undefined,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  useEffect(() => {
    if (!items.length) return;
    const timer = setTimeout(() => setItems((current) => current.slice(1)), 4200);
    return () => clearTimeout(timer);
  }, [items]);
  const push = useCallback((message: string, tone: "info" | "error" = "info") => {
    setItems((current) => [...current, { id: Date.now() + Math.random(), message, tone }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 border px-4 py-3",
              item.tone === "error"
                ? "border-accent bg-bg text-accent"
                : "border-ink bg-bg text-ink",
            )}
          >
            <span className="type-body-sm flex-1">{item.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setItems((current) => current.filter((i) => i.id !== item.id))}
              className="text-muted hover:text-ink"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* --------------------------------- tabs ----------------------------------- */

export function CourseTabs({
  courseId,
  active,
}: {
  courseId: string;
  active: "lecture" | "whiteboard" | "quiz" | "review";
}) {
  const router = useRouter();
  const tabs: { key: typeof active; label: string }[] = [
    { key: "lecture", label: "Lecture" },
    { key: "whiteboard", label: "Whiteboard" },
    { key: "quiz", label: "Quiz" },
    { key: "review", label: "Review" },
  ];
  return (
    <nav aria-label="Course views" className="no-scrollbar -mx-4 flex gap-5 overflow-x-auto border-b border-rule px-4 md:mx-0 md:gap-6 md:overflow-visible md:px-0">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`/courses/${courseId}/${tab.key}`}
            onPointerEnter={() => {
              if (!isActive) {
                void prefetchCourse(courseId);
                router.prefetch(`/courses/${courseId}/${tab.key}`);
              }
            }}
            onFocus={() => {
              if (!isActive) {
                void prefetchCourse(courseId);
                router.prefetch(`/courses/${courseId}/${tab.key}`);
              }
            }}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "type-label -mb-px shrink-0 whitespace-nowrap border-b-2 px-1 py-3.5 transition-colors md:py-3",
              isActive
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function StepList<T extends { id: string }>({
  steps,
  activeIndex,
  doneIndexes,
  onSelect,
  render,
}: {
  steps: T[];
  activeIndex: number;
  doneIndexes: number[];
  onSelect?: (index: number) => void;
  render: (step: T, index: number) => ReactNode;
}) {
  return (
    <ol className="divide-y divide-[var(--rule)] border border-rule">
      {steps.map((step, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect?.(index)}
              className={cn(
                "w-full px-4 py-4 text-left transition-colors",
                state === "active"
                  ? "border-l-4 border-l-accent bg-surface-2"
                  : "border-l-4 border-l-transparent hover:bg-surface-2",
              )}
            >
              {render(step, index)}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
