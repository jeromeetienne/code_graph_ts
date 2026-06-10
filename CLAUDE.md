# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Style

- Write in plain English. No slang or informal jargon.
- Do not abbreviate code-related terms: write "function" not "fn", "variable" not "var",
  "argument" not "arg", "object" not "obj", "property" not "prop", and so on.
- Use complete sentences in prose responses.

## Coding Style

When generating TypeScript code, follow these conventions:

### Conditionals
- **Never use `!varName` in if conditions.** Always use explicit checks: `=== null`, `=== undefined`, `=== false`, `!== null`, `!== undefined`, etc.

### TypeScript
- Prefer `type` aliases and Zod schemas for data shapes
- Use `async/await` over raw Promises
- Avoid `any`; prefer `unknown` when the type is genuinely unknown
- Named exports only; no default exports
- Document functions, types, and non-obvious logic with JSDoc comments

### Naming
- `camelCase` for variables and functions
- `PascalCase` for classes, interfaces, and type aliases
- `snake_case` for file names
- `UPPER_SNAKE_CASE` for true constants

### Formatting
- 8-tab indentation
- Single quotes for strings
- Trailing commas in multi-line structures
- Semicolons required

### Code Organization
- All exported functions in a module must live in a static class named after the file (snake_case → PascalCase). Example: `ai_client.ts` → `class AiClient { static … }`. Classes with internal state use instance methods instead.
- Early returns over deeply nested conditions
- No unnecessary comments — let code speak for itself

## Tech Stack

- **TypeScript** (ES2020, strict), run via `tsx` for development
- **@openai/agents** — agent/tool orchestration
- **@atproto/api** — Bluesky protocol
- **Zod** — runtime validation of SKILL.md frontmatter
- **gray-matter** — markdown frontmatter parsing (used in skillmd_runner but missing from package.json)
- **Commander.js** — CLI arg parsing (both packages)
- **Chalk** — terminal colors (bsky_cli)

## Git

- When creating commits, do **not** append a `Co-Authored-By: Claude …` trailer, or
  any Anthropic/Claude email (e.g. `noreply@anthropic.com`), to the commit message.
  The commit message should contain only the change description.
