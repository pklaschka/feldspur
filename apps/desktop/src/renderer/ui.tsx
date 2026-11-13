/** Kleine, wiederverwendbare Bausteine auf Tailwind und Radix. */
import { Collapsible, Select, Switch, ToggleGroup, Tooltip } from "radix-ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { SourceKind } from "@feldspur/core/model";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "default" | "primary" | "link" | "ghost";
const VARIANT: Record<Variant, string> = {
  default:
    "rounded-[7px] border border-line-2 bg-panel shadow-xs hover:enabled:border-muted data-[state=on]:border-accent data-[state=on]:bg-accent-soft",
  primary: "rounded-[7px] border border-accent bg-accent font-medium text-accent-ink hover:enabled:brightness-110",
  link: "text-accent hover:underline",
  ghost: "rounded-md hover:bg-sunken",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const pad = variant === "link" ? "" : size === "sm" ? "px-2.5 py-0.5 text-[0.82rem]" : "px-3 py-1.5";
  return (
    <button
      className={cx(
        "cursor-pointer whitespace-nowrap disabled:cursor-default disabled:opacity-50",
        pad,
        VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Pill({ tone = "plain", children }: { tone?: "plain" | "accent" | "warn"; children: ReactNode }) {
  const t = {
    plain: "bg-sunken text-ink-2",
    accent: "bg-accent-soft font-medium text-accent",
    warn: "bg-warn-soft text-warn",
  }[tone];
  return <span className={cx("inline-block rounded-full px-2 text-[0.72rem] whitespace-nowrap", t)}>{children}</span>;
}

export function Glyph({ kind, size = "md" }: { kind: SourceKind; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cx(
        `k-${kind} inline-grid flex-none place-items-center rounded-[7px] bg-k/15 text-[0.8rem] text-k`,
        size === "sm" ? "size-[22px]" : "size-[26px]",
      )}
    >
      <KindIcon kind={kind} size={size === "sm" ? 13 : 15} />
    </span>
  );
}

/** Kleine Linien-Symbole je Quellenart, statt Unicode-Zeichen, die je nach Schrift verschieden groß sind. */
const KIND_PATHS: Record<SourceKind, string> = {
  video: "M3 5.5h7.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM11.5 8.2 15 6v6l-3.5-2.2",
  audio: "M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2ZM4 8a4 4 0 0 0 8 0M8 12v2.5",
  photo:
    "M2.5 5h2.2l1.2-1.5h4.2L11.3 5h2.2a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 7a2.3 2.3 0 1 0 0 4.6A2.3 2.3 0 0 0 8 7Z",
  diary: "M4 2.5h7.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4ZM4 2.5v11M2.8 5h2.4M2.8 8h2.4M2.8 11h2.4M7 5.5h3.5M7 8h3.5",
  note: "M3.5 4h9M3.5 7h9M3.5 10h6M3.5 13h4",
  gps: "M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14ZM8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  other: "M4 8h.01M8 8h.01M12 8h.01",
};
export function KindIcon({ kind, size = 15 }: { kind: SourceKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={kind === "other" ? 2.5 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={KIND_PATHS[kind]} />
    </svg>
  );
}

/**
 * Kopf eines Arbeitsschritts: Titel, ein Satz Stand, rechts die Aktionen (der Weiter-Knopf immer zuletzt).
 * Längere Erklärungen stehen eingeklappt unter „Wie funktioniert das?“.
 */
export function StepHeader({
  title,
  summary,
  help,
  children,
}: {
  title: string;
  summary?: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Collapsible.Root className="mb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-56 flex-[1_1_0%]">
          <h2 className="text-[1.05rem] font-semibold">{title}</h2>
          {(summary || help) && (
            <p className="text-[0.85rem] text-muted">
              {summary}
              {help && (
                <>
                  {summary && " "}
                  <Collapsible.Trigger className="cursor-pointer text-accent hover:underline data-[state=open]:font-medium">
                    Wie funktioniert das?
                  </Collapsible.Trigger>
                </>
              )}
            </p>
          )}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {help && (
        <Collapsible.Content className="mt-2 max-w-[72ch] rounded-lg border border-line bg-panel-2 px-3.5 py-2.5 text-[0.85rem] text-ink-2">
          {help}
        </Collapsible.Content>
      )}
    </Collapsible.Root>
  );
}

/** Schließen-Knopf mit ausreichend großer Fläche. */
export function CloseButton({ onClick, label = "Schließen" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="m4 4 8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

/** Erklärt die Statuspunkte. */
export function StatusLegend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-muted">
      {(["ok", "check", "unplaced"] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusDot status={s} />
          {STATUS_LEGEND[s]}
        </span>
      ))}
    </span>
  );
}
const STATUS_LEGEND = { ok: "sicher", check: "prüfen", unplaced: "ohne Zeit" } as const;

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("mt-4 mb-1.5 text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase", className)}>
      {children}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[10px] border border-line bg-panel px-4.5 py-4 shadow-xs", className)}>
      {children}
    </section>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="my-2 rounded-[7px] bg-accent-soft px-3 py-1.5 text-[0.85rem]">{children}</p>;
}

export function StatusDot({ status, className }: { status: "ok" | "check" | "unplaced"; className?: string }) {
  return <span className={cx("inline-block size-2 flex-none rounded-full", STATUS_BG[status], className)} />;
}
export const STATUS_TEXT_CLASS = { ok: "text-good", check: "text-warn", unplaced: "text-bad" } as const;
const STATUS_BG = { ok: "bg-good/60", check: "bg-warn", unplaced: "bg-bad" } as const;

/** Radix-Tooltip mit einheitlichem Aussehen. */
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-[0.78rem] whitespace-pre-line text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
        >
          {content}
          <Tooltip.Arrow className="fill-ink dark:fill-panel-2" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TooltipProvider = Tooltip.Provider;

/** Einzelauswahl als Knopfreihe (Radix ToggleGroup). */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  label: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="inline-flex w-fit overflow-hidden rounded-[7px] border border-line-2"
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          title={o.title}
          className="cursor-pointer border-l border-line-2 bg-panel px-2.5 py-1 text-[0.8rem] first:border-l-0 hover:enabled:bg-sunken disabled:cursor-default disabled:opacity-40 data-[state=on]:bg-accent-soft data-[state=on]:font-medium data-[state=on]:text-accent"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/** Auswahlliste (Radix Select). */
export function Picker({
  value,
  onChange,
  options,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <Select.Root value={value || undefined} onValueChange={onChange}>
      <Select.Trigger
        aria-label={label}
        className={cx(
          "inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-line-2 bg-panel px-2 py-1 text-left data-[placeholder]:text-muted",
          className,
        )}
      >
        <span className="truncate">
          <Select.Value placeholder={placeholder} />
        </span>
        <Select.Icon className="text-muted">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-panel shadow-lg"
        >
          <Select.Viewport className="p-1">
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="cursor-pointer rounded px-2 py-1 outline-none data-[highlighted]:bg-accent-soft data-[state=checked]:font-medium"
              >
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/** Ein-/Ausschalter (Radix Switch). */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative h-4 w-7 flex-none cursor-pointer rounded-full bg-line-2 data-[state=checked]:bg-accent"
    >
      <Switch.Thumb className="block size-3 translate-x-0.5 rounded-full bg-panel transition-transform data-[state=checked]:translate-x-[14px]" />
    </Switch.Root>
  );
}

export const PRECISION_OPTIONS = [
  { value: "exact" as const, label: "genau", title: "± 1 Sekunde" },
  { value: "approx" as const, label: "ungefähr", title: "± 1 Minute" },
  { value: "rough" as const, label: "grob", title: "± 15 Minuten" },
];
