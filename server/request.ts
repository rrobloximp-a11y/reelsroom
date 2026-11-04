import { AsyncLocalStorage } from "node:async_hooks";

export type CurrentUser = { id: string; email: string; name?: string } | null;

export type RequestInfo = {
  token: string | null;
  ip: string;
  userAgent: string;
  user?: Promise<CurrentUser>;
};

export const requestStore = new AsyncLocalStorage<RequestInfo>();

export function requestInfo(): RequestInfo {
  return requestStore.getStore() ?? { token: null, ip: "", userAgent: "" };
}
