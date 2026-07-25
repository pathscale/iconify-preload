# Frontend conventions — iconify-preload

Read this **before** opening implementation files, so context stays small and existing
conventions are followed. It covers implementing, debugging, reviewing and refactoring this package.

Stack: **rsbuild**, **Bun**, **Biome**.

## Non-negotiables

- **Use Bun and Biome**, and this repository's actual validation commands (below) —
  not a remembered command from another project.
- Follow existing structure before introducing a new pattern.

## Validation

```bash
bun run build
```

Run the smallest relevant check first; widen only if it passes or the failure is unclear.
