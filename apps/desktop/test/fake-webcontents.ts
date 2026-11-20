import { EventEmitter } from "node:events";
import type { WebContents } from "electron";

/** Ersatz für die Oberfläche: nimmt Nachrichten entgegen und kennt die Ereignisse, auf die die Ausgabe hört. */
export function fakeWebContents(send: (channel: string, ...args: never[]) => unknown = () => {}): WebContents {
  let throttling = true;
  return Object.assign(new EventEmitter(), {
    send,
    isDestroyed: () => false,
    getBackgroundThrottling: () => throttling,
    setBackgroundThrottling: (on: boolean) => (throttling = on),
  }) as unknown as WebContents;
}
