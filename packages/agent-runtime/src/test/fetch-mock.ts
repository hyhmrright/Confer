// Shared global-`fetch` stub for the LLM provider tests. Both provider suites
// need the same three things — swap `fetch`, record what was sent, restore the
// real one — and had their own copy of it. Test-only: nothing reachable from
// `src/index.ts` imports this, so it never reaches the bundle.

export interface FetchCall {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

// Replace global fetch with `impl`, recording every call it receives.
export function mockFetch(impl: (url: string, init: RequestInit) => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const finalInit = init ?? {};
    calls.push({ url, init: finalInit });
    return impl(url, finalInit);
  }) as typeof fetch;
}

// Every fetch recorded since the last reset, oldest first.
export function fetchCalls(): FetchCall[] {
  return calls;
}

// The JSON body of the most recent request — what the provider actually sent.
export function lastBody(): Record<string, unknown> {
  const call = calls[calls.length - 1];
  if (!call) throw new Error('no fetch call recorded');
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

// Drop recorded calls so one test can't see another's requests (`beforeEach`).
export function resetFetchCalls(): void {
  calls = [];
}

// Put the real global fetch back (`afterEach`), so a suite that follows this
// one isn't left talking to the stub.
export function restoreFetch(): void {
  globalThis.fetch = realFetch;
}
