/** Kleine, wiederverwendbare Bausteine auf Tailwind und Radix. */
import { Select, Switch, ToggleGroup, Tooltip } from "radix-ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { SourceKind } from "@feldspur/core/model";
import { KIND_GLYPH } from "./format.ts";

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
      {KIND_GLYPH[kind]}
    </span>
  );
}

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
          className="z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-[0.78rem] whitespace-pre-line text-panel shadow-lg"
        >
          {content}
          <Tooltip.Arrow className="fill-ink" />
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
      className="inline-flex overflow-hidden rounded-[7px] border border-line-2"
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
