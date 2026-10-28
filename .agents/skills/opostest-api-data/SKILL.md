---
name: opostest-api-data
description: Use when changing OposTest API routes, data ownership, Drizzle storage, request schemas, or server-backed tests.
---

# OposTest API and Data

Use the authenticated server identity as the ownership boundary for every private
resource. Keep the HTTP contract in `shared/routes.ts`, route wiring in
`server/routes.ts`, and database predicates in `server/storage.ts` aligned.

## Source map

- `server/routes.ts`: Express handlers, `requireAuth`, Zod error mapping, and the
  intentionally unavailable remote-import endpoints.
- `server/storage.ts`: Drizzle queries; private rows are scoped with `userId` in
  every read, update, and delete predicate.
- `server/auth.ts`: Passport serializes an id and restores `{ id, username }`.
- `shared/schema.ts`: PostgreSQL tables and Zod 3 schemas derived with
  `drizzle-zod`; do not accept `userId` from client input.
- `shared/routes.ts`: API paths, input parsers, typed response shapes, and
  `buildUrl`.
- `server/config.ts`: environment validation for sessions and registration.
- `script/run-tests.ts`: isolated PostgreSQL test runner.

## Ownership and route rules

1. Put `requireAuth` before every private route. Derive the owner only from
   `req.user!.id`; never read an owner id from params, body, query, or headers.
2. Pass that id to storage and require it again in SQL predicates. A missing row
   or another user's row should follow the existing `404` behavior, not reveal
   ownership.
3. Parse path ids with `parsePositiveId`; parse request bodies with the contract
   schema and return the existing generic `400` response for `z.ZodError`.
4. Keep `shared/routes.ts`, `shared/schema.ts`, route handlers, and client
   response parsing in lockstep when adding or changing an endpoint.
5. Preserve HTTP semantics used here: `201` for creation, `204` for a successful
   deletion, `401` for unauthenticated access, and `404` for absent/unowned data.

## Drizzle and transactions

This project uses Drizzle ORM 0.39 and Zod 3. Keep schema-derived inserts strict
where they already are, and define an explicit strict Zod schema for partial
updates when a derived insert schema does not express the contract.

Use a transaction when an operation relies on a verified set of rows before it
writes dependent state. `createAttempt` is the reference: validate unique,
positive question ids, lock and verify user-owned questions in the transaction,
then insert the attempt. Do not move that verification to the client.

```ts
const rows = await tx.select({ id: questions.id }).from(questions).where(and(
  eq(questions.testId, testId), eq(questions.userId, userId),
  inArray(questions.id, questionOrder),
)).for("share");
if (rows.length !== questionOrder.length) return undefined;
```

For an owner-scoped mutation, preserve the predicate shape:

```ts
where(and(eq(table.id, id), eq(table.userId, userId)))
```

## Remote import boundary

`/api/remote/list` and `/api/remote/fetch` currently return `503` after auth.
They are deliberately disabled. Do not re-enable outbound fetching, URL parsing,
or a feature flag as collateral work. Local JSON import remains the supported
route.

## Verification

Run only checks relevant to the edited surface; do not run app tests for a
documentation-only change.

- API/types/schema change: `npm.cmd run check` and `npm.cmd run test`.
- Owner isolation or mutation change: `npm.cmd run test:sec01` plus the affected
  Node test through `npm.cmd run test -- <file>` when needed.
- Remote endpoint change: `npm.cmd run test -- tests/sec-02-remote-disabled.test.ts`.
- Release/build-sensitive server change: `npm.cmd run build`.

`npm.cmd run test` invokes `script/run-tests.ts`. With no `TEST_DATABASE_URL`,
it creates and removes a temporary Docker PostgreSQL 17 container. An explicit
test URL is checked against development and rejected if they identify the same
database. The runner pushes the schema to the test database, so use only a
disposable database. Do not aim tests at development or production data.

## Change checklist

- Confirm auth and owner predicates for list, get, create, update, and delete.
- Test both owner success and other-user `404` when authorization changes.
- Keep client-supplied fields untrusted even if TypeScript types include them.
- Report executed checks separately from checks not run because Docker, browser,
  or environment prerequisites were unavailable.
