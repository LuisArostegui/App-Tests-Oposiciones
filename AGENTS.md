# Repository guidance

Respond in Spanish unless the user requests another language. Keep code identifiers and technical skill instructions in English, and product UI text in Spanish.

## Scope and architecture

- Preserve unrelated working-tree changes. Follow the user's branch and commit instructions; adding skills does not authorize application changes, dependency upgrades, commits or publishing.
- Check `package.json`, `package-lock.json` and the relevant source before applying version-sensitive guidance. The current architecture is React 18 + Vite 7 + Wouter, Express 4 + Passport sessions, TanStack Query 5, Drizzle/PostgreSQL, Zod 3, and Radix/shadcn with Tailwind 3.
- Use npm and the existing lockfile. In PowerShell use `npm.cmd` / `npx.cmd` when script execution policy requires it. Do not introduce another package manager or test runner as a side effect.

## Skills: load only those relevant to the task

Paths below are relative to the repository root. Read the selected `SKILL.md` before using its workflow. Project-specific guidance and the installed dependency versions take precedence over generic upstream recommendations.

| Task | Skill entry point |
| --- | --- |
| API routes, authentication, authorization, Zod contracts or Drizzle storage | `.agents/skills/opostest-api-data/SKILL.md` |
| Query keys, mutations, saved attempts or session/cache transitions | `.agents/skills/opostest-query-flows/SKILL.md` |
| Service worker, cache migration, offline behavior or app updates | `.agents/skills/opostest-pwa/SKILL.md` |
| Requested security review or secure-by-default implementation | `.agents/skills/security-best-practices/SKILL.md` |
| React rendering, asynchronous work or bundle performance | `.agents/skills/vercel-react-best-practices/SKILL.md` |
| Requested UI, UX or accessibility review | `.agents/skills/web-design-guidelines/SKILL.md` |
| Existing shadcn/Radix components, forms, styling or composition | `.agents/skills/shadcn/SKILL.md` |
| TanStack Query fetching, cache lifetime or mutation patterns | `.agents/skills/tanstack-query-best-practices/SKILL.md` |
| Interactive browser investigation or manual flow verification | `.agents/skills/playwright/SKILL.md` |

Use the already installed Superpowers workflows when applicable; they are not duplicated here.

## Compatibility rules for vendored skills

- React guidance: use React 18 APIs. Next.js, React Server Components, Next routing/caching and React 19-only patterns do not apply to this Vite SPA. Keep Wouter and the existing TanStack Query transport.
- shadcn guidance: inspect `components.json` and `client/src/components/ui/` first. Reuse the existing Radix components, React Hook Form/Zod integration and Tailwind 3 configuration. New upstream primitives such as `Field` or `InputGroup` are conditional on their actual presence and compatibility; their mention does not require regenerating components, changing design tokens, switching to Base UI or upgrading Tailwind.
- Query guidance: preserve private-session epochs, transition guards, cancellation and callback protection in the existing transport/hooks. Reconcile invalidation and optimistic updates with account isolation and server authority; generic examples do not justify removing these protections.
- Playwright guidance: the upstream CLI wrapper uses Bash. On Windows use Git Bash if available, or the documented equivalent `npx.cmd --yes --package @playwright/cli playwright-cli <args>`. For automated regression tests use the existing `npm.cmd run test:browser` suite instead of replacing it with interactive CLI automation.
- External skills are vendored with their supporting files. `.agents/skills/sources.json` records exact upstream commits; retain attribution and bundled licenses. Update deliberately and inspect the diff rather than fetching a new version automatically. `web-design-guidelines` fetches its review checklist remotely; record that source/date when producing an audit, and disclose when network access prevents refresh.

## Verification

Choose checks according to the actual change:

- TypeScript: `npm.cmd run check`.
- Build or asset integration: `npm.cmd run build`.
- API/storage behavior: `npm.cmd test -- tests/<relevant-file>.test.ts`; inspect `script/run-tests.ts` first. Its runner applies the schema to an isolated test database, using Docker or an explicit `TEST_DATABASE_URL`. Do not point it at development or production data.
- Browser/session/service-worker integration: `npm.cmd run test:browser`. Inspect `tests/browser/playwright.config.mjs` and its fixture server; fixture success is not proof of the production API or real database behavior.
- Skill-only changes: validate frontmatter, local references, source provenance and task routing. Application tests are unnecessary unless application behavior also changes.

Report commands actually executed and their results. Distinguish static review, fixture tests, real API/database checks and deployment evidence. Existing audit documents are leads to revalidate, not proof that an old issue remains open.
