# TypeScript that Node can run directly

Node 22.6+ can execute `.ts` files by stripping types. Node 24 does this by
default, with no build step and no `ts-node`. The trade-off: only syntax that can
be erased is allowed.

## What works

- Type annotations, interfaces, type aliases, generics, `as` casts.
- `import type` / `export type`.
- `satisfies`, non-null assertions, optional chaining.
- `private` / `readonly` / `abstract` modifiers on declarations.
- Type-only `namespace` blocks and `declare` statements.
- `import.meta.dirname` and `import.meta.filename` (Node 20.11+).

## What fails

| Syntax | Error | Fix |
| --- | --- | --- |
| `enum` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | Use an `as const` object plus a union type |
| `namespace` containing runtime code | same | Move values to a module |
| Parameter properties (`constructor(private x: T)`) | same | Declare the field and assign it in the body |
| Decorators | parser error | Not supported by type stripping |
| `import { SomeType }` without `type` | runtime error (treated as a value import) | `import type { SomeType }` |
| Extensionless imports | `ERR_MODULE_NOT_FOUND` | Write `./file.ts` |

Example replacement for an enum:

```ts
export const Status = { Idle: 'idle', Busy: 'busy' } as const
export type Status = (typeof Status)[keyof typeof Status]
```

## Module resolution

- `node` does not read `tsconfig.json`. `paths` aliases do not exist at runtime;
  use relative paths or `#subpath` imports from `package.json`.
- Set `"type": "module"` and use ESM syntax; `.mts` is always ESM.
- Import specifiers must include the extension: `import { x } from './x.ts'`.

## Recommended tsconfig for a no-build project

```json
{
    "compilerOptions": {
        "target": "esnext",
        "module": "nodenext",
        "moduleResolution": "nodenext",
        "noEmit": true,
        "allowImportingTsExtensions": true,
        "erasableSyntaxOnly": true,
        "verbatimModuleSyntax": true,
        "strict": true,
        "types": ["node"]
    }
}
```

`erasableSyntaxOnly` makes `tsc` reject syntax Node cannot strip, so typecheck
and runtime agree. `verbatimModuleSyntax` enforces explicit `import type`, which
is what the runtime needs.

## Testing

`node --test` discovers `*.test.ts`, `test/**/*.{ts,mts,cts}` and friends. Pass
explicit globs to scope a run:

```bash
node --test "test/unit/**/*.test.ts"
```

A file placed under `test/` matches the default patterns, so keep paid or
network-dependent checks out of the default run by giving them their own script
and path, for example `node --test test/live/checks.ts`.

## Sources

- <https://nodejs.org/api/typescript.html>
- <https://nodejs.org/api/test.html>
