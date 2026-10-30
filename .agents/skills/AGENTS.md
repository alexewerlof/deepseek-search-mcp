# .agents/skills/AGENTS.md

Portable agent skills: instructions an AI agent loads on demand. Each skill is a
directory containing a `SKILL.md` with YAML frontmatter plus optional
`references/` files.

## Skills in this repo

| Skill | Owns |
| --- | --- |
| `mcp-server-design/` | How to design MCP servers: primitives, tool contracts, output budgets, error mapping, transport choice, secrets |
| `mcp-typescript-sdk/` | SDK v2 recipes: factories, `registerTool`, HTTP/stdio entry points, bearer auth, tests, Node type-stripping limits |
| `deepseek-search-fetch/` | DeepSeek Search and Fetch facts: fields, operators, errors, rate limits, billing, result rendering |

The skills are the *why*; `AGENTS.md` files are the *what* and *where*. Do not
copy a skill's reasoning into an `AGENTS.md`; link to it.

## Format rules

1. **Directory name must equal the frontmatter `name`.** A mismatch makes the
   skill silently fail to load.
2. `name`: lowercase letters, digits and hyphens only, ≤64 characters, no
   namespace prefixes or slashes.
3. `description`: ≤1024 characters. This is the *only* text an agent sees before
   deciding to load the skill, so state both what it does and when to use it, and
   name the concrete triggers (tool names, APIs, symptoms).
4. **Body under ~500 lines.** Move depth into `references/` and link it from the
   body; an unreferenced file is never read.
5. Write in the imperative and explain *why* a rule exists. A list of bare MUSTs
   gets ignored.
6. One skill per coherent domain. Do not create a skill for a single file.

## Editing rules

- **Markdown is Prettier-ignored** in this repo (`.prettierignore` has `**/*.md`),
  so `npm run fmt` will not reflow it. Keep prose wrapped by hand at ~90 columns
  and keep code blocks under 120 columns.
- Cite sources at the bottom of `SKILL.md` and in references. A fact without a
  source is a rumour.
- Keep facts versioned and dated when they can rot (API fields, package versions,
  host behaviour). Say which SDK version you verified against.
- Never put a real credential, hostname or personal path in a skill.

## Adding a skill

1. Create `.agents/skills/<name>/SKILL.md` with `name` matching the directory.
2. Write the trigger-focused description first; it decides whether the skill is
   ever used.
3. Add `references/` files only if the body would otherwise exceed ~500 lines.
4. Reference every extra file from the body.
5. Update the table above.

## Related

- [../AGENTS.md](../AGENTS.md)
