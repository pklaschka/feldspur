import type { FeldspurApi } from "../shared/api.ts";

declare global {
  interface Window {
    feldspur: FeldspurApi;
  }
}
