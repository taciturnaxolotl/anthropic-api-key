# CRUSH.md

Build/Lint/Test
- Install: bun install
- Typecheck: bun x tsc --noEmit
- Run: bun run index.ts or bun index.ts
- Test all: bun test
- Test watch: bun test --watch
- Test single: bun test path/to/file.test.ts -t "name"
- Lint: bun x biome check --write || bun x eslint . (if configured)

Conventions
- Runtime: Bun (see CLAUDE.md). Prefer Bun APIs (Bun.serve, Bun.file, Bun.$) over Node shims. Bun auto-loads .env.
- Modules: ESM only ("type": "module"). Use extensionless TS imports within project.
- Formatting: Prettier/biome if present; otherwise 2-space indent, trailing commas where valid, semicolons optional but consistent.
- Types: Strict TypeScript. Prefer explicit types on public APIs; infer locals via const. Use unknown over any. Narrow with guards.
- Imports: Group std/bun, third-party, then local. Use named imports; avoid default exports for libs.
- Naming: camelCase for vars/functions, PascalCase for types/classes, UPPER_SNAKE for env constants.
- Errors: Throw Error (or subclasses) with actionable messages; never swallow. Use Result-like returns only if established.
- Async: Prefer async/await. Always handle rejections. Avoid top-level await outside Bun entrypoints.
- Logging: Use console.* sparingly; no secrets in logs. Prefer structured messages.
- Env/config: Read via process.env or Bun.env at startup; validate and fail fast.
- Files: Prefer Bun.file and Response over fs. Avoid sync IO.
- Tests: bun:test (import { test, expect } from "bun:test"). Keep tests deterministic, no network without mocking.

Repo Notes
- No Cursor/Copilot rules detected.
- Add ".crush" dir to .gitignore (keeps agent scratch files untracked).
