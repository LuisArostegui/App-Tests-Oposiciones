---
name: opostest-query-flows
description: Use when changing OposTest React Query fetching, private mutations, authentication transitions, or attempt saving flows.
---

# OposTest Query and Session Flows

Treat private React Query state as session-bound. Existing code already handles
epochs, transition recovery, cross-tab events, and stale callbacks; extend that
model instead of adding a second cache-clearing or synchronization mechanism.

## Source map

- `client/src/lib/queryClient.ts`: `QueryClient`, credentials-aware fetching,
  private-session epoch, abortable writes, query clearing, transitions, and
  BroadcastChannel/localStorage fallback.
- `client/src/hooks/use-private-mutation.ts`: captures an epoch at mutation
  start and suppresses obsolete mutation callbacks.
- `client/src/hooks/use-auth.ts`: login, registration, logout, route changes,
  and session-transition lifecycle.
- `client/src/hooks/use-attempts.ts`: protected queries, per-attempt write queue,
  invalidation, and user-visible delete errors.
- `shared/routes.ts`: typed endpoint paths, inputs, and response parsers.
- `tests/sec-05-private-cache.test.ts` and `tests/browser/`: session-isolation
  coverage, including account changes, tabs, old responses, and interrupted logout.

## Private fetches and query keys

Use `apiFetch` for protected API calls. It sends credentials, turns a current
`401` into the standard session-expiry error, aborts tracked writes on a session
change, and rejects a write that completes under a different epoch.

Use stable keys derived from `api.*.path`; include resource identity as a later
key component, as `useAttempt` does:

```ts
queryKey: [api.attempts.get.path, id]
```

Pass React Query's `signal` to reads. Parse successful payloads with the
corresponding `shared/routes.ts` response schema before returning them.

## Session transitions are a protocol

Login, registration, and logout already use `meta: { sessionTransition: true }`,
`beginPrivateSessionTransition`, and `finishPrivateSessionTransition`. Preserve
the lifecycle on both success and error; it prevents private data from one
identity being rendered during a change of identity.

Do not replace it with a simple `queryClient.clear()`, manually advance an epoch,
or make session-transition callbacks subject to their own newly advanced epoch.
`usePrivateMutation` deliberately permits callbacks marked as session
transitions while still blocking stale ordinary callbacks.

When a private session changes, `clearPrivateQueryData` cancels queries, clears
the client, advances the epoch, aborts in-flight writes, and broadcasts to other
tabs. Preserve all of these effects. The cross-tab path supports
`BroadcastChannel` and localStorage fallback; do not assume either storage API
is always available.

## Mutations and invalidation

Wrap private changes in `usePrivateMutation`, not bare `useMutation`. Its
callbacks must retain the original options callbacks and only run if the
captured epoch remains valid. This applies to optimistic rollbacks, toasts,
navigations, and invalidations.

On success, invalidate the exact affected keys. For attempt updates, invalidate
both the list and the specific detail key. Keep error feedback inside the
mutation callbacks so an error does not silently look like a saved change.

```ts
onSuccess: (_, variables) => {
  queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
  queryClient.invalidateQueries({ queryKey: [api.attempts.get.path, variables.id] });
}
```

## Attempt writes

`enqueueAttemptUpdate` serializes writes per attempt id and captures an epoch
before waiting. Retain both properties: do not let a later autosave overtake an
earlier one, and do not issue a queued write after logout/login. If adding a new
attempt write entry point, use this queue or an equivalent per-id mechanism;
do not introduce a global queue that blocks independent attempts.

## Verification

Run only checks fitting the change; documentation-only changes need none.

- Type-only or hook contract change: `npm.cmd run check`.
- Query/session unit behavior: `npm.cmd run test -- tests/sec-05-private-cache.test.ts`.
- UI session change, stale response, or multi-tab behavior:
  `npm.cmd run test:browser`.
- Build-affecting client wiring: `npm.cmd run build`.

`tests/browser/playwright.config.mjs` uses local app and service-worker fixtures,
serial execution, and retained traces/screenshots on failure. Inspect that
configuration before relying on fixed ports or server lifecycle assumptions.
It is behavioral coverage, not a substitute for owner checks in server tests.

## Review prompts

- Can a response or callback begun under account A change UI/cache after B logs in?
- Does logout clear private query state in the initiating tab and another live tab?
- Are mutation success, error, and settled callbacks guarded by the epoch?
- Does a failed save surface an error and avoid a misleading success invalidation?
