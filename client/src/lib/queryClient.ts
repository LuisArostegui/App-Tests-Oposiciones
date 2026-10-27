import { QueryClient, QueryFunction, QueryCache, MutationCache } from "@tanstack/react-query";

const SESSION_EVENT = "opostest:session-changed";
const SESSION_STORAGE_KEY = "opostest:session-change";
const TRANSITION_STORAGE_PREFIX = "opostest:session-transition:";
let sessionTransition = false;
const pendingSessionTransitions = new Set<string>();
const settledSessionTransitions = new Set<string>();
const sessionChannel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel(SESSION_EVENT)
  : null;

function persistSessionTransition(transitionId: string, phase: "active" | "settled") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${TRANSITION_STORAGE_PREFIX}${transitionId}`, phase);
  } catch {
    // BroadcastChannel continues to carry private-data invalidations when storage is blocked.
  }
}

export function applyPersistedSessionTransition(transitionId: string, phase: "active" | "settled") {
  if (phase === "active") {
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(`${TRANSITION_STORAGE_PREFIX}${transitionId}`) === "settled") return;
    } catch {
      if (settledSessionTransitions.has(transitionId)) return;
    }
  }
  persistSessionTransition(transitionId, phase);
  if (phase === "active") {
    if (!settledSessionTransitions.has(transitionId)) pendingSessionTransitions.add(transitionId);
  } else {
    pendingSessionTransitions.delete(transitionId);
    rememberSettledTransition(transitionId);
  }
  sessionTransition = pendingSessionTransitions.size > 0;
  notifyLocalSessionChange();
}

if (typeof window !== "undefined") {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(TRANSITION_STORAGE_PREFIX)) continue;
      const transitionId = key.slice(TRANSITION_STORAGE_PREFIX.length);
      const phase = window.localStorage.getItem(key);
      if (phase === "active") pendingSessionTransitions.add(transitionId);
      if (phase === "settled") settledSessionTransitions.add(transitionId);
    }
  } catch {
    // Existing tabs still synchronize through their live session events.
  }
}
sessionTransition = pendingSessionTransitions.size > 0;

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const res = await fetch(input, { credentials: "include", ...init });
  if (res.status === 401) {
    throw new Error("401: La sesión ha caducado. Inicia sesión de nuevo.");
  }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

function handleUnauthorized(error: unknown) {
  if (error instanceof Error && /^401:/.test(error.message)) {
    void clearPrivateQueryData();
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function setSessionTransition(isTransitioning: boolean) {
  sessionTransition = isTransitioning;
}

export function isSessionTransitioning() {
  return sessionTransition;
}

function notifyLocalSessionChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { transitioning: sessionTransition } }));
  }
}

function publishSessionMessage(message: { type: string; transitionId?: string }) {
  if (typeof window === "undefined") return;
  if (sessionChannel) {
    sessionChannel.postMessage(message);
    return;
  }
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...message, nonce: `${Date.now()}-${Math.random()}` }));
  } catch {
    // Cross-tab propagation is unavailable when both messaging and storage are blocked.
  }
}

async function clearQueryState() {
  await queryClient.cancelQueries();
  queryClient.clear();
}

export async function clearPrivateQueryData(broadcast = true) {
  await clearQueryState();
  notifyLocalSessionChange();
  if (broadcast) publishSessionMessage({ type: "invalidate-private-session" });
}

export async function beginPrivateSessionTransition(): Promise<string> {
  const transitionId = `${Date.now()}-${Math.random()}`;
  applyPersistedSessionTransition(transitionId, "active");
  publishSessionMessage({ type: "session-transition-start", transitionId });
  await clearQueryState();
  return transitionId;
}

export async function finishPrivateSessionTransition(transitionId: string | undefined): Promise<void> {
  await clearQueryState();
  if (transitionId) {
    applyPersistedSessionTransition(transitionId, "settled");
  } else {
    sessionTransition = pendingSessionTransitions.size > 0;
    notifyLocalSessionChange();
  }
  if (transitionId) publishSessionMessage({ type: "session-transition-settled", transitionId });
}

function rememberSettledTransition(transitionId: string) {
  settledSessionTransitions.delete(transitionId);
  settledSessionTransitions.add(transitionId);
  if (settledSessionTransitions.size > 256) {
    const oldest = settledSessionTransitions.values().next().value;
    if (oldest) settledSessionTransitions.delete(oldest);
  }
}

export async function receivePrivateSessionMessage(message: { type?: string; transitionId?: string }) {
  if (message.type === "session-transition-start" && message.transitionId) {
    if (pendingSessionTransitions.has(message.transitionId) || settledSessionTransitions.has(message.transitionId)) return;
    applyPersistedSessionTransition(message.transitionId, "active");
    await clearQueryState();
    return;
  }

  if (message.type === "session-transition-settled" && message.transitionId) {
    await clearQueryState();
    applyPersistedSessionTransition(message.transitionId, "settled");
    return;
  }

  if (message.type === "invalidate-private-session") {
    await clearPrivateQueryData(false);
  }
}

if (typeof window !== "undefined") {
  sessionChannel?.addEventListener("message", (event) => {
    void receivePrivateSessionMessage(event.data);
  });

  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith(TRANSITION_STORAGE_PREFIX)) {
      const transitionId = event.key.slice(TRANSITION_STORAGE_PREFIX.length);
      const phase = event.newValue;
      if (phase === "active" || phase === "settled") {
        void receivePrivateSessionMessage({
          type: phase === "active" ? "session-transition-start" : "session-transition-settled",
          transitionId,
        });
      }
      return;
    }
    if (event.key === SESSION_STORAGE_KEY) {
      try {
        void receivePrivateSessionMessage(JSON.parse(event.newValue ?? "{}"));
      } catch {
        void clearPrivateQueryData(false);
      }
    }
  });
}
