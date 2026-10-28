import { QueryClient, QueryFunction, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-error";

const SESSION_EVENT = "opostest:session-changed";
const SESSION_STORAGE_KEY = "opostest:session-change";
const TRANSITION_STORAGE_PREFIX = "opostest:session-transition:";
const SESSION_PAGE_ID_KEY = "opostest:session-page-id";
const PAGE_PRESENCE_PREFIX = "opostest:session-page:";
const PRESENCE_HEARTBEAT_MS = 5_000;
const PRESENCE_STALE_AFTER_MS = 120_000;
let sessionTransition = false;
let privateSessionEpoch = 0;
const pendingSessionTransitions = new Set<string>();
const interruptedSessionTransitions = new Set<string>();
const settledSessionTransitions = new Set<string>();
const inFlightPrivateWrites = new Set<AbortController>();
const mutationEpochs = new Map<number, number>();

type TransitionPhase = "active" | "interrupted" | "settled";
interface TransitionRecord {
  phase: TransitionPhase;
  pageId?: string;
  instanceId?: string;
}

function randomId() {
  return `${Date.now()}-${Math.random()}`;
}

function getSessionPageId() {
  if (typeof window === "undefined") return `node-${randomId()}`;
  try {
    const existing = window.sessionStorage.getItem(SESSION_PAGE_ID_KEY);
    if (existing) return existing;
    const created = randomId();
    window.sessionStorage.setItem(SESSION_PAGE_ID_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

const sessionPageId = getSessionPageId();
const sessionPageInstanceId = randomId();
const sessionChannel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel(SESSION_EVENT)
  : null;

function parseTransitionRecord(value: string | null): TransitionRecord | undefined {
  if (value === "active" || value === "interrupted" || value === "settled") return { phase: value };
  if (!value) return undefined;
  try {
    const record = JSON.parse(value) as Partial<TransitionRecord>;
    if (record.phase === "active" || record.phase === "interrupted" || record.phase === "settled") return record as TransitionRecord;
  } catch {
    // Ignore malformed app-owned transition data; authentication is still checked by the server.
  }
  return undefined;
}

function readTransitionRecord(transitionId: string) {
  if (typeof window === "undefined") return undefined;
  try {
    return parseTransitionRecord(window.localStorage.getItem(`${TRANSITION_STORAGE_PREFIX}${transitionId}`));
  } catch {
    return undefined;
  }
}

function persistSessionTransition(transitionId: string, phase: TransitionPhase, pageId?: string, instanceId?: string) {
  if (typeof window === "undefined") return;
  try {
    const previous = readTransitionRecord(transitionId);
    const record: TransitionRecord = phase === "active"
      ? { phase, pageId: pageId ?? sessionPageId, instanceId: instanceId ?? sessionPageInstanceId }
      : { phase, pageId: pageId ?? previous?.pageId, instanceId: instanceId ?? previous?.instanceId };
    window.localStorage.setItem(`${TRANSITION_STORAGE_PREFIX}${transitionId}`, JSON.stringify(record));
  } catch {
    // BroadcastChannel continues to carry transitions when storage is blocked.
  }
}

export function applyPersistedSessionTransition(transitionId: string, phase: TransitionPhase, pageId?: string, instanceId?: string) {
  if (phase === "active") {
    try {
      if (readTransitionRecord(transitionId)?.phase === "settled") return;
    } catch {
      if (settledSessionTransitions.has(transitionId)) return;
    }
  }
  persistSessionTransition(transitionId, phase, pageId, instanceId);
  if (phase === "active") {
    if (!settledSessionTransitions.has(transitionId) && !pendingSessionTransitions.has(transitionId)) {
      pendingSessionTransitions.add(transitionId);
      advancePrivateSessionEpoch();
    }
  } else if (phase === "interrupted") {
    if (!pendingSessionTransitions.has(transitionId)) advancePrivateSessionEpoch();
    pendingSessionTransitions.add(transitionId);
    interruptedSessionTransitions.add(transitionId);
  } else {
    pendingSessionTransitions.delete(transitionId);
    interruptedSessionTransitions.delete(transitionId);
    rememberSettledTransition(transitionId);
  }
  sessionTransition = pendingSessionTransitions.size > 0;
  notifyLocalSessionChange();
}

function presenceKey(pageId: string, instanceId: string) {
  return `${PAGE_PRESENCE_PREFIX}${pageId}:${instanceId}`;
}

function readPagePresence(pageId: string, instanceId: string): { instanceId: string; seenAt: number } | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(presenceKey(pageId, instanceId));
    if (!value) return undefined;
    const parsed = JSON.parse(value) as { instanceId?: unknown; seenAt?: unknown };
    if (typeof parsed.instanceId === "string" && typeof parsed.seenAt === "number") {
      return { instanceId: parsed.instanceId, seenAt: parsed.seenAt };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isTransitionOwnerAlive(record: TransitionRecord) {
  if (!record.pageId || !record.instanceId) return false;
  const presence = readPagePresence(record.pageId, record.instanceId);
  return presence?.instanceId === record.instanceId && Date.now() - presence.seenAt < PRESENCE_STALE_AFTER_MS;
}

function markTransitionInterrupted(transitionId: string) {
  if (!pendingSessionTransitions.has(transitionId) || interruptedSessionTransitions.has(transitionId)) return;
  applyPersistedSessionTransition(transitionId, "interrupted");
  publishSessionMessage({ type: "session-transition-interrupted", transitionId });
}

function reconcilePersistedTransitions() {
  if (typeof window === "undefined") return;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(TRANSITION_STORAGE_PREFIX)) continue;
      const transitionId = key.slice(TRANSITION_STORAGE_PREFIX.length);
      const record = parseTransitionRecord(window.localStorage.getItem(key));
      if (record?.phase === "active") {
        if (isTransitionOwnerAlive(record)) {
          pendingSessionTransitions.add(transitionId);
        } else {
          pendingSessionTransitions.add(transitionId);
          markTransitionInterrupted(transitionId);
        }
      } else if (record?.phase === "interrupted") {
        pendingSessionTransitions.add(transitionId);
        interruptedSessionTransitions.add(transitionId);
      } else if (record?.phase === "settled") {
        pendingSessionTransitions.delete(transitionId);
        interruptedSessionTransitions.delete(transitionId);
        settledSessionTransitions.add(transitionId);
      }
    }
  } catch {
    // A later authentication request still verifies identity when storage is unavailable.
  }
  sessionTransition = pendingSessionTransitions.size > 0;
}

function updatePagePresence() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(presenceKey(sessionPageId, sessionPageInstanceId), JSON.stringify({ instanceId: sessionPageInstanceId, seenAt: Date.now() }));
  } catch {
    // Live BroadcastChannel messages still protect tabs when storage is blocked.
  }
}

if (typeof window !== "undefined") {
  reconcilePersistedTransitions();
  updatePagePresence();
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
  const method = (init.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const epoch = privateSessionEpoch;
  const controller = isWrite ? new AbortController() : undefined;
  if (controller) inFlightPrivateWrites.add(controller);
  const callerSignal = init.signal;
  const abortFromCaller = () => controller?.abort();
  if (controller && callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  try {
    const res = await fetch(input, { credentials: "include", ...init, ...(controller ? { signal: controller.signal } : {}) });
    if (isWrite && !isPrivateSessionEpochCurrent(epoch)) throw new Error("La sesión cambió mientras se guardaban estos datos.");
    if (res.status === 401) {
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      throw new ApiError(401, "La sesión ha caducado. Inicia sesión de nuevo.");
    }
    return res;
  } finally {
    if (controller) {
      inFlightPrivateWrites.delete(controller);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
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
  mutationCache: new MutationCache({
    onMutate: (_variables, mutation) => {
      mutationEpochs.set(mutation.mutationId, privateSessionEpoch);
    },
    onError: (error, _variables, _context, mutation) => {
      if (mutationEpochs.get(mutation.mutationId) === privateSessionEpoch) handleUnauthorized(error);
    },
    onSettled: (_data, _error, _variables, _context, mutation) => {
      mutationEpochs.delete(mutation.mutationId);
    },
  }),
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

export function capturePrivateSessionEpoch() {
  return privateSessionEpoch;
}

export function isPrivateSessionEpochCurrent(epoch: number) {
  return epoch === privateSessionEpoch;
}

function advancePrivateSessionEpoch() {
  privateSessionEpoch += 1;
  for (const controller of Array.from(inFlightPrivateWrites)) controller.abort();
  inFlightPrivateWrites.clear();
}

function notifyLocalSessionChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { transitioning: sessionTransition } }));
  }
}

function publishSessionMessage(message: { type: string; transitionId?: string; pageId?: string; instanceId?: string }) {
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
  advancePrivateSessionEpoch();
  await clearQueryState();
  notifyLocalSessionChange();
  if (broadcast) publishSessionMessage({ type: "invalidate-private-session" });
}

export async function beginPrivateSessionTransition(): Promise<string> {
  const transitionId = `${Date.now()}-${Math.random()}`;
  applyPersistedSessionTransition(transitionId, "active", sessionPageId, sessionPageInstanceId);
  publishSessionMessage({ type: "session-transition-start", transitionId, pageId: sessionPageId, instanceId: sessionPageInstanceId });
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

export function interruptSessionTransition(transitionId: string) {
  markTransitionInterrupted(transitionId);
}

export async function recoverInterruptedSessionTransitions<T>(revalidateIdentity: () => Promise<T>): Promise<T | null> {
  reconcilePersistedTransitions();
  const interruptedIds = Array.from(interruptedSessionTransitions);
  if (interruptedIds.length === 0 || pendingSessionTransitions.size !== interruptedSessionTransitions.size) return null;

  const sessionEpochAtStart = privateSessionEpoch;
  const transitionStateAtStart = getSessionTransitionState();
  const identity = await revalidateIdentity();
  reconcilePersistedTransitions();
  if (!isPrivateSessionEpochCurrent(sessionEpochAtStart)) return null;
  if (getSessionTransitionState() !== transitionStateAtStart) return null;
  for (const transitionId of interruptedIds) {
    if (!interruptedSessionTransitions.has(transitionId)) continue;
    persistSessionTransition(transitionId, "settled");
    pendingSessionTransitions.delete(transitionId);
    interruptedSessionTransitions.delete(transitionId);
    rememberSettledTransition(transitionId);
    publishSessionMessage({ type: "session-transition-settled", transitionId });
  }
  sessionTransition = pendingSessionTransitions.size > 0;
  return sessionTransition ? null : identity;
}

function getSessionTransitionState() {
  return Array.from(pendingSessionTransitions)
    .sort()
    .map((transitionId) => `${transitionId}:${interruptedSessionTransitions.has(transitionId) ? "interrupted" : "active"}`)
    .join("|");
}

function rememberSettledTransition(transitionId: string) {
  settledSessionTransitions.delete(transitionId);
  settledSessionTransitions.add(transitionId);
  if (settledSessionTransitions.size > 256) {
    const oldest = settledSessionTransitions.values().next().value;
    if (oldest) settledSessionTransitions.delete(oldest);
  }
}

export async function receivePrivateSessionMessage(message: { type?: string; transitionId?: string; pageId?: string; instanceId?: string }) {
  if (message.type === "session-transition-start" && message.transitionId) {
    if (pendingSessionTransitions.has(message.transitionId) || settledSessionTransitions.has(message.transitionId)) return;
    applyPersistedSessionTransition(message.transitionId, "active", message.pageId, message.instanceId);
    await clearQueryState();
    return;
  }

  if (message.type === "session-transition-interrupted" && message.transitionId) {
    await clearQueryState();
    applyPersistedSessionTransition(message.transitionId, "interrupted");
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
  const handlePageHide = () => {
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(TRANSITION_STORAGE_PREFIX)) continue;
        const transitionId = key.slice(TRANSITION_STORAGE_PREFIX.length);
        const record = parseTransitionRecord(window.localStorage.getItem(key));
        if (record?.phase === "active" && record.pageId === sessionPageId && record.instanceId === sessionPageInstanceId) {
          markTransitionInterrupted(transitionId);
        }
      }
      const ownPresenceKey = presenceKey(sessionPageId, sessionPageInstanceId);
      if (readPagePresence(sessionPageId, sessionPageInstanceId)) window.localStorage.removeItem(ownPresenceKey);
    } catch {
      // When storage is unavailable, the pagehide notification still reaches live tabs through BroadcastChannel.
    }
  };

  window.addEventListener("pagehide", handlePageHide);
  window.setInterval(() => {
    const wasTransitioning = sessionTransition;
    updatePagePresence();
    reconcilePersistedTransitions();
    if (wasTransitioning !== sessionTransition) notifyLocalSessionChange();
  }, PRESENCE_HEARTBEAT_MS);

  sessionChannel?.addEventListener("message", (event) => {
    void receivePrivateSessionMessage(event.data);
  });

  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith(TRANSITION_STORAGE_PREFIX)) {
      const transitionId = event.key.slice(TRANSITION_STORAGE_PREFIX.length);
      const record = parseTransitionRecord(event.newValue);
      const phase = record?.phase;
      if (phase === "active" || phase === "interrupted" || phase === "settled") {
        void receivePrivateSessionMessage({
          type: phase === "active" ? "session-transition-start" : phase === "interrupted" ? "session-transition-interrupted" : "session-transition-settled",
          transitionId,
          pageId: record?.pageId,
          instanceId: record?.instanceId,
        });
      }
      return;
    }
    if (event.key?.startsWith(PAGE_PRESENCE_PREFIX)) {
      const wasTransitioning = sessionTransition;
      reconcilePersistedTransitions();
      if (wasTransitioning !== sessionTransition) notifyLocalSessionChange();
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
