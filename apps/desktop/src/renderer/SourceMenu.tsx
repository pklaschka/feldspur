/**
 * Menüs zum Pflegen von Quellen und Geräten: verschieben, zu einer Seite verbinden,
 * als Tagebuchseite oder Foto behandeln, als Folgeaufnahme markieren, aus dem Projekt nehmen, Geräte zusammenlegen.
 */
import { AlertDialog, DropdownMenu } from "radix-ui";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";
import { Button, cx } from "./ui.tsx";
import { useDraft } from "./hooks.ts";

export interface SourceActions {
  remove(sourceId: string): void;
  move(sourceId: string, target: string | { newLabel: string }): void;
  mergeDevices(fromId: string, intoId: string): void;
  setDeviceUtc(deviceId: string, utc: boolean): void;
  setDeviceTimeZone(deviceId: string, timeZone: string | null): void;
  setPartOf(sourceId: string, mainId: string | null): void;
  /** Bild als Tagebuchseite oder als Foto behandeln. */
  setSourceKind(sourceId: string, kind: "diary" | "photo"): void;
  setFollows(sourceId: string, prevId: string | null): void;
  preview(sourceId: string): void;
  /** Mitschreiben für eine Audio- oder Videoquelle öffnen. */
  transcribe(sourceId: string): void;
  /** Als Kontext führen (bewusst ohne Uhrzeit, vor der Chronologie) oder zurück in die Chronologie holen. */
  setContext(sourceId: string, on: boolean): void;
  /** Abtipp-Ansicht einer Tagebuchseite öffnen. */
  openDiary(sourceId: string): void;
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
  "flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-[0.9rem] outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft";
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
    <b className="font-mono text-[0.85rem]">{r.label}</b>
    <span className="truncate text-ink-2">{r.fileName}</span>
  </>
);

/** „⋯“-Menü einer Quelle. */
/** „Als Kontext führen“ bzw. „Zurück in die Chronologie“; bei Ton und Video ausgegraut, mit Grund. */
function ContextItem({ row, view }: { row: SourceRow; view: SessionView }) {
  const a = useActions();
  if (row.status === "context")
    return (
      <DropdownMenu.Item className={item} onSelect={() => a.setContext(row.id, false)} data-testid="menu-context-off">
        Zurück in die Chronologie
      </DropdownMenu.Item>
    );
  if (AV.has(row.kind))
    return (
      <DropdownMenu.Item
        className={item}
        disabled
        title="Ton und Video brauchen eine Uhrzeit, weil sie ins Montagevideo gehen."
      >
        Als Kontext führen
      </DropdownMenu.Item>
    );
  const dated =
    row.kind === "diary" &&
    view.diary.some((e) => e.role === "timeline" && e.notedAt && e.regions.some((r) => r.sourceId === row.id));
  // Die ganze Seite umzustellen würde datierte Einträge mitnehmen: dann einzelne Teile beim Abtippen.
  if (dated)
    return (
      <DropdownMenu.Item className={item} onSelect={() => a.openDiary(row.id)}>
        Teile der Seite als Kontext führen…
      </DropdownMenu.Item>
    );
  const sub =
    row.kind === "diary"
      ? "Ganze Seite, ohne Uhrzeit"
      : row.startMs !== null
        ? "Verlässt die Zeitachse. Die Uhrzeit bleibt gemerkt."
        : "Ohne Uhrzeit, steht vor der Chronologie.";
  return (
    <DropdownMenu.Item className={item} onSelect={() => a.setContext(row.id, true)} data-testid="menu-context-on">
      <span className="grid">
        {row.kind === "diary" ? "Seite als Kontext führen" : "Als Kontext führen"}
        <span className="text-[0.8rem] text-muted">{sub}</span>
      </span>
    </DropdownMenu.Item>
  );
}

export function SourceMenu({ row, view, className }: { row: SourceRow; view: SessionView; className?: string }) {
  const a = useActions();
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
            <DropdownMenu.Label className="truncate px-2.5 pt-1 pb-1.5 text-[0.8rem] text-muted">
              {row.label} · {row.fileName}
            </DropdownMenu.Label>
            {(row.previewable || row.isPdf || AV.has(row.kind)) && (
              <DropdownMenu.Item className={item} onSelect={() => a.preview(row.id)}>
                Groß ansehen
              </DropdownMenu.Item>
            )}
            {AV.has(row.kind) && (
              <DropdownMenu.Item className={item} onSelect={() => a.transcribe(row.id)}>
                Mitschreiben…
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
            {IMAGE.has(row.kind) && !row.partOf && (
              <DropdownMenu.Item
                className={item}
                onSelect={() => a.setSourceKind(row.id, row.kind === "photo" ? "diary" : "photo")}
              >
                {row.kind === "photo" ? "Als Tagebuchseite behandeln" : "Als Foto behandeln"}
              </DropdownMenu.Item>
            )}
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
            {!row.partOf && <ContextItem row={row} view={view} />}
            <DropdownMenu.Separator className={sep} />
            {/* Ohne Nachfrage: danach erscheint ein Hinweis mit „Rückgängig“ (auch Strg/⌘+Z). */}
            <DropdownMenu.Item className={cx(item, "text-bad")} onSelect={() => a.remove(row.id)}>
              Aus Projekt entfernen
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

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

/** Menü am Gerät: mit einem anderen Gerät zusammenlegen, UTC-Zeitstempel umstellen. */
export function DeviceMenu({ device, view }: { device: DeviceRow; view: SessionView }) {
  const a = useActions();
  const [into, setInto] = useState<DeviceRow | null>(null);
  const [zoning, setZoning] = useState(false);
  const others = view.allDevices.filter((d) => d.id !== device.id);
  const sessionZone = view.session.timeZone;
  const noClock = device.kind === "diary" || device.kind === "note";
  if (!others.length && !device.hasUtcStamps && noClock) return null;
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
            {others.length > 0 && (
              <Sub label="Zusammenlegen mit …">
                {others.map((d) => (
                  <DropdownMenu.Item key={d.id} className={item} onSelect={() => setInto(d)}>
                    {d.label}
                  </DropdownMenu.Item>
                ))}
              </Sub>
            )}
            {!noClock && (
              <>
                {others.length > 0 && <DropdownMenu.Separator className={sep} />}
                <DropdownMenu.Label className="px-2.5 pt-1 pb-0.5 text-[0.8rem] text-muted">
                  Zeitzone der Geräteuhr
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={device.timeZone === null ? "session" : device.timeZone === "UTC" ? "UTC" : "other"}
                  onValueChange={(v) => {
                    if (v === "session") a.setDeviceTimeZone(device.id, null);
                    else if (v === "UTC") a.setDeviceTimeZone(device.id, "UTC");
                    else setZoning(true);
                  }}
                >
                  <DropdownMenu.RadioItem value="session" className={item}>
                    <Dot on={device.timeZone === null} />
                    Wie der Einsatz ({sessionZone})
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="UTC" className={item}>
                    <Dot on={device.timeZone === "UTC"} />
                    UTC
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="other" className={item}>
                    <Dot on={device.timeZone !== null && device.timeZone !== "UTC"} />
                    {device.timeZone !== null && device.timeZone !== "UTC" ? device.timeZone : "Andere …"}
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </>
            )}
            {device.hasUtcStamps && (
              <>
                <DropdownMenu.Separator className={sep} />
                <DropdownMenu.Label className="px-2.5 pt-1 pb-0.5 text-[0.8rem] text-muted">
                  Zeitstempel in UTC (Metadaten, Dateiname)
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={device.timestampsAreUtc ? "utc" : "local"}
                  onValueChange={(v) => a.setDeviceUtc(device.id, v === "utc")}
                >
                  <DropdownMenu.RadioItem value="utc" className={item}>
                    <Dot on={device.timestampsAreUtc} />
                    Sind UTC, in Ortszeit umrechnen
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="local" className={item}>
                    <Dot on={!device.timestampsAreUtc} />
                    Sind schon Ortszeit, so lesen
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ZoneDialog
        open={zoning}
        onOpenChange={setZoning}
        title={`Zeitzone der Uhr von „${device.label}“`}
        initial={device.timeZone ?? sessionZone}
        onSubmit={(z) => a.setDeviceTimeZone(device.id, z)}
      />
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

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cx("size-2 flex-none rounded-full border border-muted", on && "border-accent bg-accent")}
    />
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

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

/** Zeitzone der Geräteuhr eingeben (IANA, z. B. America/New_York). */
function ZoneDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial: string;
  onSubmit: (zone: string) => void;
}) {
  // Beim Öffnen mit dem aktuellen Wert beginnen.
  const [zone, setZone] = useDraft(initial, open);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(26rem,90vw)] -translate-1/2 rounded-xl border border-line bg-panel p-5 shadow-xl">
          <AlertDialog.Title className="font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[0.9rem] text-ink-2">
            Auf welche Zeitzone war die Uhr des Geräts gestellt? Seine Ortszeit-Stempel werden von dort in die Zeitzone
            des Einsatzes umgerechnet.
          </AlertDialog.Description>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!zone.trim()) return;
              onSubmit(zone.trim());
              onOpenChange(false);
            }}
          >
            <input
              autoFocus
              aria-label="Zeitzone der Geräteuhr"
              value={zone}
              list="feldspur-device-zones"
              onChange={(e) => setZone(e.target.value)}
            />
            <datalist id="feldspur-device-zones">
              {ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button">Abbrechen</Button>
              </AlertDialog.Cancel>
              <Button variant="primary" type="submit" disabled={!zone.trim()}>
                Übernehmen
              </Button>
            </div>
          </form>
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
