/**
 * Menüs zum Pflegen von Quellen und Geräten: verschieben, zu einer Seite verbinden,
 * als Folgeaufnahme markieren, aus dem Projekt nehmen, Geräte zusammenlegen.
 */
import { AlertDialog, DropdownMenu } from "radix-ui";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";
import { Button, cx } from "./ui.tsx";

export interface SourceActions {
  remove(sourceId: string): void;
  move(sourceId: string, target: string | { newLabel: string }): void;
  mergeDevices(fromId: string, intoId: string): void;
  setPartOf(sourceId: string, mainId: string | null): void;
  setFollows(sourceId: string, prevId: string | null): void;
  preview(sourceId: string): void;
}

const Ctx = createContext<SourceActions | null>(null);
export const SourceActionsProvider = Ctx.Provider;
export function useActions(): SourceActions {
  const a = useContext(Ctx);
  if (!a) throw new Error("SourceActionsProvider fehlt");
  return a;
}

const IMAGE = new Set(["photo", "diary"]);
const AV = new Set(["audio", "video"]);

const item =
  "flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-[0.85rem] outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft";
const content = "z-50 min-w-56 max-w-80 rounded-lg border border-line bg-panel p-1 shadow-lg";
const sep = "my-1 h-px bg-line";

function Sub({ label, children, disabled }: { label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={item} disabled={disabled}>
        {label}
        <span className="ml-auto text-muted">›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className={cx(content, "max-h-80 overflow-y-auto")} sideOffset={4}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

const rowLabel = (r: SourceRow) => (
  <>
    <b className="font-mono text-[0.8rem]">{r.label}</b>
    <span className="truncate text-ink-2">{r.fileName}</span>
  </>
);

/** „⋯“-Menü einer Quelle. */
export function SourceMenu({ row, view, className }: { row: SourceRow; view: SessionView; className?: string }) {
  const a = useActions();
  const [confirm, setConfirm] = useState(false);
  const [naming, setNaming] = useState(false);
  const others = view.allDevices.filter((d) => d.id !== row.deviceId);
  const pages = view.rows.filter((r) => r.id !== row.id && IMAGE.has(r.kind) && !r.partOf && r.partOf !== row.id);
  const takenPrev = new Set(view.rows.map((r) => r.follows).filter(Boolean));
  const prevs = view.rows
    .filter((r) => r.id !== row.id && AV.has(r.kind) && r.durationMs !== null && !takenPrev.has(r.id))
    .sort((x, y) => Number(y.deviceId === row.deviceId) - Number(x.deviceId === row.deviceId));
  const main = row.partOf ? view.rows.find((r) => r.id === row.partOf) : undefined;
  const prev = row.follows ? view.rows.find((r) => r.id === row.follows) : undefined;

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Aktionen für ${row.label}`}
            title="Aktionen"
            className={cx(
              "grid size-7 flex-none cursor-pointer place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink data-[state=open]:bg-sunken",
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <circle cx="3.5" cy="8" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="12.5" cy="8" r="1.4" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={content} align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}>
            <DropdownMenu.Label className="truncate px-2.5 pt-1 pb-1.5 text-[0.75rem] text-muted">
              {row.label} · {row.fileName}
            </DropdownMenu.Label>
            {(row.previewable || row.isPdf || AV.has(row.kind)) && (
              <DropdownMenu.Item className={item} onSelect={() => a.preview(row.id)}>
                Groß ansehen
              </DropdownMenu.Item>
            )}
            {!row.partOf && (
              <Sub label="In anderes Gerät verschieben">
                {others.map((d) => (
                  <DropdownMenu.Item key={d.id} className={item} onSelect={() => a.move(row.id, d.id)}>
                    {d.label}
                  </DropdownMenu.Item>
                ))}
                {others.length > 0 && <DropdownMenu.Separator className={sep} />}
                <DropdownMenu.Item className={item} onSelect={() => setNaming(true)}>
                  Neues Gerät…
                </DropdownMenu.Item>
              </Sub>
            )}
            {IMAGE.has(row.kind) &&
              (main ? (
                <DropdownMenu.Item className={item} onSelect={() => a.setPartOf(row.id, null)}>
                  Von Seite {main.label} lösen
                </DropdownMenu.Item>
              ) : (
                <Sub label="Als weiteres Bild zu Seite …" disabled={!pages.length}>
                  {pages.map((r) => (
                    <DropdownMenu.Item key={r.id} className={item} onSelect={() => a.setPartOf(row.id, r.id)}>
                      {rowLabel(r)}
                    </DropdownMenu.Item>
                  ))}
                </Sub>
              ))}
            {AV.has(row.kind) &&
              (prev ? (
                <DropdownMenu.Item className={item} onSelect={() => a.setFollows(row.id, null)}>
                  Nicht mehr als Fortsetzung von {prev.label}
                </DropdownMenu.Item>
              ) : (
                <Sub label="Setzt Aufnahme fort …" disabled={!prevs.length}>
                  {prevs.map((r) => (
                    <DropdownMenu.Item key={r.id} className={item} onSelect={() => a.setFollows(row.id, r.id)}>
                      {rowLabel(r)}
                    </DropdownMenu.Item>
                  ))}
                </Sub>
              ))}
            <DropdownMenu.Separator className={sep} />
            <DropdownMenu.Item className={cx(item, "text-bad")} onSelect={() => setConfirm(true)}>
              Aus Projekt entfernen…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={`${row.label} aus dem Projekt entfernen?`}
        action="Entfernen"
        onConfirm={() => a.remove(row.id)}
      >
        <b>{row.fileName}</b> verschwindet aus diesem Einsatz, mit seinen Zeitbelegen, Ankern und Tagebuch-Rahmen. Die
        Originaldatei bleibt unverändert, wo sie ist; du kannst sie später wieder einsammeln.
      </Confirm>
      <NameDialog
        open={naming}
        onOpenChange={setNaming}
        title="Neues Gerät"
        label="Name des Geräts"
        onSubmit={(name) => a.move(row.id, { newLabel: name })}
      />
    </>
  );
}

/** Menü am Gerät: mit einem anderen Gerät zusammenlegen. */
export function DeviceMenu({ device, view }: { device: DeviceRow; view: SessionView }) {
  const a = useActions();
  const [into, setInto] = useState<DeviceRow | null>(null);
  const others = view.allDevices.filter((d) => d.id !== device.id);
  if (!others.length) return null;
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Aktionen für Gerät ${device.label}`}
            title="Gerät"
            className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink data-[state=open]:bg-sunken"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <circle cx="3.5" cy="8" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="12.5" cy="8" r="1.4" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={content} align="end" sideOffset={4}>
            <Sub label="Zusammenlegen mit …">
              {others.map((d) => (
                <DropdownMenu.Item key={d.id} className={item} onSelect={() => setInto(d)}>
                  {d.label}
                </DropdownMenu.Item>
              ))}
            </Sub>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Confirm
        open={!!into}
        onOpenChange={(o) => !o && setInto(null)}
        title={`„${device.label}“ in „${into?.label ?? ""}“ aufgehen lassen?`}
        action="Zusammenlegen"
        onConfirm={() => into && a.mergeDevices(device.id, into.id)}
      >
        Alle {device.sourceCount} Dateien wandern zu „{into?.label}“, „{device.label}“ verschwindet. Für alle gilt
        danach die Uhr von „{into?.label}“.
        {device.isReference && " Die Referenzuhr geht mit über."}
      </Confirm>
    </>
  );
}

function Confirm({
  open,
  onOpenChange,
  title,
  action,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  action: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,90vw)] -translate-1/2 rounded-xl border border-line bg-panel p-5 shadow-xl">
          <AlertDialog.Title className="font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[0.88rem] text-ink-2">{children}</AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button>Abbrechen</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={onConfirm}>
                {action}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  label: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(24rem,90vw)] -translate-1/2 rounded-xl border border-line bg-panel p-5 shadow-xl">
          <AlertDialog.Title className="font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="sr-only">{label}</AlertDialog.Description>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onSubmit(name.trim());
              setName("");
              onOpenChange(false);
            }}
          >
            <input autoFocus aria-label={label} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button">Abbrechen</Button>
              </AlertDialog.Cancel>
              <Button variant="primary" type="submit" disabled={!name.trim()}>
                Anlegen
              </Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
