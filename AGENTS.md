# Global engineering rules

## Search

Prefer native structured tools:

1. LSP for symbols, definitions and references.
2. grep for text/code search.
3. glob for file discovery.
4. Shell tools only when native tools are insufficient.

If shell search is necessary:
- prefer `rg` over `grep`
- prefer `rg --files` or `fd` over `find`

Do not repeatedly search the same paths with equivalent queries.

## Editing

- Read the relevant code before editing.
- Make the smallest coherent change.
- Avoid speculative abstractions.
- Do not rewrite unrelated code.
- Reuse existing dependencies and patterns whenever possible.
- Prefer editing an existing implementation over creating parallel implementations.

## Verification

After editing:
1. run the narrowest relevant formatter/linter/typecheck
2. run targeted tests
3. expand to broader tests only when necessary

Do not repeatedly run the entire project test suite after small edits.

## Dependencies

Before adding a dependency:
1. check whether the repository already provides equivalent functionality
2. check the standard library/runtime
3. only then add a dependency

## Repository exploration

Do not read large files in full unless necessary.
Start from:
- manifests
- relevant entry points
- symbol search
- adjacent tests

Avoid recursively dumping the repository into context.

## Git

Never:
- force push
- reset --hard
- delete user changes
- amend unrelated commits

unless explicitly requested.

