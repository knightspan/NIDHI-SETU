import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/** Per-request context (IP, user agent) so services can audit without threading it through. */
export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
};
