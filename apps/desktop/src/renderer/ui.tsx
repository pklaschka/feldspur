/** Kleine, wiederverwendbare Bausteine auf Tailwind und Radix. */
import { Tooltip } from "radix-ui";
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
