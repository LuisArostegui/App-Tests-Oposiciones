---
name: opostest-pwa
description: Use when changing the OposTest service worker, PWA caching, offline behavior, or browser validation of private-data isolation.
---

# OposTest PWA and Private Cache Policy

Cache application assets for offline navigation without ever storing or serving
private API responses from the service worker. The API policy is network-only,
including cache migration, not merely an exclusion in the fetch handler.

## Source map

- `client/public/sw.js`: cache names, install/activate migration, fetch routing,
  navigation fallback, static stale-while-revalidate, and `/api` network-only.
- `client/src/lib/queryClient.ts`: memory cache/session transitions and cross-tab
  invalidation; it complements the service worker but does not replace it.
- `client/src/hooks/use-auth.ts`: session lifecycle that must clear private UI
  state after login/logout/error.
- `tests/sec-05-private-cache.test.ts`: service-worker policy and migration tests.
- `tests/browser/playwright.config.mjs`: browser harness configuration.
- `tests/browser/sec-05-session-isolation.spec.mjs`: account switch, multi-tab,
  delayed response, expiry, and interrupted logout coverage.
- `tests/browser/sec-05-service-worker.spec.mjs` and `sec-05-server.mjs`:
  real service-worker fixture and browser policy coverage.

## Cache boundary

`client/public/sw.js` owns caches named with the `opostest-` prefix. Static and
dynamic caches contain shell/navigation/assets only. `/api` and `/api/*` must:

1. bypass `cache.match` and `cache.put`;
2. use `networkOnly(request)`;
3. return a JSON `503` with `Cache-Control: no-store` when the network fails.

Use `new URL(request.url)` and match the pathname exactly so both `/api` and
`/api/...` remain excluded. Do not add API data to the pre-cache list, dynamic
cache, navigation fallback, or any other cache name.

There is intentionally no offline write queue. Do not add background sync,
replay, IndexedDB persistence of API payloads, or a retry queue unless a future
requirement explicitly designs ownership, authentication, ordering, conflict,
and user-facing failure semantics.

## Migration is part of the policy

On `activate`, `migrateAndCleanCaches` only copies requests from recognized old
OposTest static/dynamic caches when they are same-origin GET requests outside
`/api`. Its cleanup currently deletes old caches with the `opostest-` prefix.
Preserve the migration filter:
an old service-worker cache may already contain sensitive API data, so migration
must not carry it forward.

Avoid broad deletion or migration based only on a cache-name prefix; unrelated
caches must remain untouched. If versioning changes, continue to recognize only
the prior app cache families that this worker owns.

## Routing and offline behavior

- Navigation: network first; cache the application shell at `/` only after a
  successful response; use cached shell or offline HTML as a fallback.
- Non-API GET assets: stale-while-revalidate, caching only successful responses.
- Non-GET requests: leave them to the browser/network; do not synthesize an
  offline write success.
- API GET and mutations: network-only. An unavailable network must be visible
  to the caller as failure, never as cached or queued private data.

## Verification

Run checks proportionally; do not run app tests for documentation-only work.

- Service-worker policy or migration change:
  `npm.cmd run test -- tests/sec-05-private-cache.test.ts`.
- Login/logout, stale private UI, or cross-tab behavior:
  `npm.cmd run test:browser`.
- Type/build-visible client or public-asset wiring: `npm.cmd run check` and
  `npm.cmd run build`.

Inspect the current browser configuration: it runs serially with separate app
and service-worker fixture servers on loopback ports 4175 and 4174. Neither
fixture proves production API/database behavior. Cover actual browser behavior when claiming cache
privacy: logout then another account, a second tab, an old delayed response,
session expiry, and interrupted logout each exercise different failure modes.

## Change checklist

- Verify both fetch routing and activate-time migration exclude `/api`.
- Confirm an API outage returns an explicit error rather than private cached data.
- Confirm app shell/assets still work offline as intended.
- Keep the service-worker policy and React Query session clearing complementary.
- Report static/unit checks and browser evidence separately; state if browser
  prerequisites prevented a rerun.
