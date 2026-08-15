# Full review: iconify-preload, rsbuild-plugin-ui-css-purge, wss-adapter

**Date:** 2026-07-27
**Scope:** three published npm packages, reviewed end to end (every source file, config, test):
- `/Users/revenge/code/iconify-preload` (`@pathscale/rsbuild-plugin-iconify` 1.0.4): `src/**`, `package.json`, `tsconfig.json`, `biome.json`, `README.md`
- `/Users/revenge/code/rsbuild-plugin-ui-css-purge` (`@pathscale/rsbuild-plugin-ui-css-purge` 0.9.12): `src/**`, `tests/**`, `build.ts`, `package.json`, `README.md`
- `/Users/revenge/code/wss-adapter` (`@pathscale/wss-adapter` 2.0.11): `src/**`, `package.json`, `biome.json`, `README.md`

Cross-referenced read-only against consumers: `/Users/revenge/code/UI`, `/Users/revenge/code/nofilter.io`, `/Users/revenge/code/js.software`, `/Users/revenge/code/web3.trading`.

**Commits:** iconify-preload `69f668c`, rsbuild-plugin-ui-css-purge `cc26051`, wss-adapter `3e6982d`. All three working trees clean.
**Reviewer slice:** "full" for all three packages. Sibling slices cover `UI` and `nofilter.io`; findings there are cited, not re-derived.

## Summary

- **iconify-preload emits CSS that cannot match anything.** Every generated rule is `.icon-[mdi--close]{...}` with unescaped brackets. Proven with lightningcss: that parses as class `icon-` plus attribute selector `[mdi--close]`, not as the class `icon-[mdi--close]` that the markup actually carries. The 7.9 KB `generated-icons.css` shipped inside `@pathscale/ui` is dead bytes; icons in consumer apps render only because those apps independently load `@plugin "@iconify/tailwind4"`, which escapes correctly. Fix is one line, but it means the package's core value has never actually been delivered.
- The same package makes `@iconify/json` a **hard runtime dependency**: 429 MB installed, paid by every consumer of the plugin, to read a few dozen icons.
- **rsbuild-plugin-ui-css-purge is conservative in the dimension it was designed for and unsafe in three it was not.** Class-level purging genuinely keeps unknown classes, so Tailwind utilities emitted from `@pathscale/ui` JS survive (verified: of 912 class tokens across 92 `*.classes.ts` files, only 3 escape the Tailwind filter, and all 3 are BEM). But the `@keyframes`, `@font-face` and CSS-variable sweeps run per file with naive value parsing, and they will delete live rules on any Tailwind v4 consumer.
- There is **no safelist flag, no dry-run, no report-only mode**, and the tool overwrites `dist/*.css` in place. When it is wrong, it is silently wrong in the shipped artifact.
- **wss-adapter's private-state leak is a design failure, not a consumer failure.** `__store` is a declared field on the public `IWssAdapter` interface and exposes the raw `WebSocket` plus all pending promises. Six hooks in nofilter.io reach into it because the alternative, `subscribeTo`, cannot express what they need. The concrete replacement API is sketched below and is the highest-value item in this document.
- wss-adapter also has a **global pending-promise map**: closing one service's socket rejects every other service's in-flight calls, and timed-out requests are never deleted from the map.
- wss-adapter's `biome` devDependency (`biome@0.3.3`) is **not Biome**: it is an unrelated abandoned 2016 package pulling `bluebird`/`request-promise`. `bun run lint` has never linted anything, and `bun test` is stubbed out to `echo` while a real 10-assertion test file sits next to it.
- **Top 3 to do:** (1) escape the brackets in iconify-preload's selector output and demote `@iconify/json` to a peer dependency; (2) fix or disable the keyframe/font/var sweeps in the purger and add `--safelist` plus `--dry-run` before anyone wires it into a real build; (3) ship the wss-adapter subscription primitive and stop exporting `__store` on the public type.

---

# Part 1: iconify-preload (`@pathscale/rsbuild-plugin-iconify` 1.0.4)

**What it is:** an rsbuild plugin that scans `./src` for `icon-[set--name]` class usage, reads matching icons out of the locally installed `@iconify/json`, and writes a CSS file of data-URI masks. There is **no network fetch at any point**: `locate()` resolves a path inside `node_modules/@iconify/json`, and the only remote resolution is the task-runner shell-out described in `iconify-preload-full-03`. Cache invalidation: there is none; the file is fully regenerated on every `onBeforeBuild`.

## Findings

### [SEV-1] Generated icon selectors are unescaped, so no icon rule ever matches
- **ID:** `iconify-preload-full-01`
- **Severity:** Critical
- **Category:** Correctness
- **Confidence:** High (verified by parsing both forms with lightningcss)
- **Location:** `/Users/revenge/code/iconify-preload/src/index.ts:147-156`; output visible at `/Users/revenge/code/UI/src/styles/icons/generated-icons.css:1` and in the published `@pathscale/ui` tarball at `/Users/revenge/code/js.software/node_modules/@pathscale/ui/dist/styles/icons/generated-icons.css`
- **What:** The CSS is built by string interpolation: `` iconCSS += `\n.icon-[${iconSet}--${iconName}] {\n  --svg: ${dataURI};\n}` `` and likewise for `.icon-[...].iconify` and `.icon-[...].iconify-color`. In CSS a class selector is a dot followed by an identifier, and `[` cannot appear in an identifier, so `.icon-[mdi--close]` parses as the class `icon-` **plus the attribute-presence selector** `[mdi--close]`. The markup it is meant to target (`<span class="icon-[mdi--close] iconify">`, README lines 55-58, and `Icon.tsx` merging `local.name` into `class`) carries a single class token `icon-[mdi--close]`, which only `.icon-\[mdi--close\]` selects. Verified directly:

  ```
  $ node -e "…lightningcss transform with a Selector visitor…"
  .icon-[mdi--close]     -> [{"type":"class","name":"icon-"},{"type":"attribute","name":"mdi--close","operation":null}]
  .icon-\[mdi--close\]   -> [{"type":"class","name":"icon-[mdi--close]"}]
  ```
- **Why it matters:** The package's entire output is inert. `--svg` is never set on the icon element, so `.iconify` (which does apply `mask-image: var(--svg)`) resolves to nothing; the element is a 1em box with `background-color: currentColor` and no mask, i.e. a solid square, unless something else supplies the rule. In practice `js.software/src/index.css:4` and `nofilter.io/src/index.css:3` load `@plugin "@iconify/tailwind4"`, which generates the correctly escaped utilities, so icons look fine and this has gone unnoticed, while `@pathscale/ui` ships 7.9 KB of unreachable CSS to every consumer and pays a 429 MB dependency to produce it.
- **Fix:** Escape the brackets when emitting the selector (the data-URI value is unaffected). Mechanical:
  ```ts
  const sel = `.icon-\\[${iconSet}--${iconName}\\]`;
  iconCSS += `\n${sel} { --svg: ${dataURI}; }\n${sel}.iconify { -webkit-mask-image: var(--svg); mask-image: var(--svg); }\n${sel}.iconify-color { background-image: var(--svg); }\n`;
  ```
  Then decide deliberately whether this plugin or `@iconify/tailwind4` owns icon CSS: with the fix, both emit the same selectors and one of them is redundant.
- **Effort:** S for the fix; M including a regression test that asserts the emitted selector round-trips to a single class node.
- **Blast radius:** `src/index.ts` only. Not a breaking API change, but it changes shipped CSS for every consumer, and `UI/src/styles/icons/generated-icons.css` is committed and would need regenerating.

### [SEV-2] `@iconify/json` (429 MB installed) is a hard runtime dependency
- **ID:** `iconify-preload-full-02`
- **Severity:** High
- **Category:** Performance | Maintainability
- **Confidence:** High
- **Location:** `/Users/revenge/code/iconify-preload/package.json:31`
- **What:** `@iconify/json` is in `dependencies`, so installing this plugin installs the complete Iconify collection. Measured on disk: `UI/node_modules/@iconify/json` = 429 MB, `promptsyntax.org` = 447 MB, `js.software` = 389 MB. `@rspack/core` is also declared as a dependency (`package.json:33`) but is never imported anywhere in `src/`: the only build-tool import is `import type { RsbuildPlugin } from '@rsbuild/core'` (`src/index.ts:3`), which is already a peer.
- **Why it matters:** Every CI install and every developer clone of every consumer downloads and extracts ~400 MB to produce, in `UI`'s case, 14 icons. Consumers that already depend on `@iconify/json` (UI does, `package.json:63`) get no dedupe benefit from it being a hard dep here; consumers that do not get it forced on them.
- **Fix:** Move `@iconify/json` to `peerDependencies` (or `peerDependenciesMeta.optional` with a clear error when `locate()` throws), delete `@rspack/core`, and make the `@rslib/core` peer optional via `peerDependenciesMeta`: the plugin has no rslib-specific code, yet today an rsbuild-only consumer gets an unmet-peer warning.
- **Effort:** S
- **Blast radius:** `package.json`; consumers must add `@iconify/json` explicitly. Breaking for installs, trivially fixable, worth a minor version bump and a README note.

### [SEV-3] CSS minification shells out to `npx`/`bunx postcss`, an unpinned build-time package fetch with unquoted paths
- **ID:** `iconify-preload-full-03`
- **Severity:** Medium
- **Category:** Security | Maintainability
- **Confidence:** High for the mechanism, Medium for how often the auto-install path is actually hit
- **Location:** `/Users/revenge/code/iconify-preload/src/utils/compress.ts:8-11`, `/Users/revenge/code/iconify-preload/src/utils/resolve-task-runner-command.ts:8-41`
- **What:** `compressCSS` builds `` `${taskRunner} postcss ${inputFile} --use cssnano --no-map -o ${outputFile}` `` and runs it through `child_process.exec` (a shell). `taskRunner` is `npx`, `bunx`, or `deno task npm:\x7F` depending on which runtime binary responds to `--version` first. This is the only place `postcss-cli` and `cssnano` are used, and they are used through a resolver that looks in the local `node_modules/.bin` **and then falls back to the registry**: `bunx` installs the latest matching package silently, `npx` prompts (and in a non-TTY CI simply fails). Under pnpm or any non-hoisted layout, a nested plugin's `postcss-cli` bin is not on the parent's `.bin` path, so the fallback is the normal path, not the exotic one.
- **Why it matters:** A build step that can fetch and execute an unpinned package from the registry is a supply-chain surface that the lockfile does not cover: the version resolved at build time is not the version in `bun.lock`. Secondary: `inputFile`/`outputFile` are interpolated into a shell string unquoted, so a `targetDir` containing a space breaks the build, and a `targetDir` containing shell metacharacters is command injection (developer-controlled config, so low exploitability, but there is no reason to accept it).
- **Fix:** Delete the subprocess entirely and call the libraries directly, since `postcss` and `cssnano` are already dependencies:
  ```ts
  import postcss from 'postcss';
  import cssnano from 'cssnano';
  const out = await postcss([cssnano()]).process(css, { from: undefined });
  ```
  That removes `compress.ts`'s `exec`, all of `resolve-task-runner-command.ts`, the `postcss-cli` dependency, and findings 04 and 05 below.
- **Effort:** S
- **Blast radius:** two files deleted/rewritten, one dependency dropped. No API change.

### [SEV-4] `process.exit(1)` inside a library, on a check that cannot legitimately fail
- **ID:** `iconify-preload-full-04`
- **Severity:** Medium
- **Category:** AI-smell | Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/iconify-preload/src/utils/resolve-task-runner-command.ts:19-27`
- **What:** `detectRuntimeExecutable()` spawns `bun --version`, then `deno --version`, then `node --version`, and if none answer, calls `process.exit(1)` after a `console.error`. There is also a `// TODO: should we design an error code system or always return 1 on error?` left in place. The check is tautological: the plugin is already executing inside a Node/Bun process, so the runtime provably exists; what the code actually wants to know is which *package runner* is on PATH.
- **Why it matters:** A library that calls `process.exit` kills the host build with no stack, no plugin name, and no way for rsbuild to report which plugin failed. Three subprocess spawns also run on every build.
- **Fix:** Subsumed by finding 03. If the shell-out is kept, throw an `Error` instead of exiting and cache the detection result across builds.
- **Effort:** S
- **Blast radius:** one file.

### [SEV-5] The Deno task-runner mapping is broken, and the comment explaining it is wrong
- **ID:** `iconify-preload-full-05`
- **Severity:** Medium
- **Category:** Correctness | AI-smell
- **Confidence:** High (static reading; I did not run Deno)
- **Location:** `/Users/revenge/code/iconify-preload/src/utils/resolve-task-runner-command.ts:29-36`
- **What:** `deno: 'deno task npm:\x7F'` with the comment "we need it to glue together the `deno task npm:` part with the npm script that is going to be run". It cannot glue anything: `compress.ts:9` interpolates it as `` `${taskRunner} postcss …` ``, producing `deno task npm:<DEL> postcss …`, a DEL character followed by a space, so `npm:` and `postcss` remain separate argv tokens. `deno task` also runs tasks declared in `deno.json`, it is not a package runner. Anyone on a machine where Deno is installed but Bun is not, and Node resolution comes third, gets this path.
- **Why it matters:** A silently broken branch with a confident wrong comment is worse than no branch: the next reader trusts it.
- **Fix:** Delete the Deno branch (subsumed by finding 03), or replace it with `deno run -A npm:postcss-cli` if Deno support is genuinely wanted, and prove it with a run.
- **Effort:** S
- **Blast radius:** one file.

### [SEV-6] `maxTotalIcons` truncates silently, and which icons are dropped is arbitrary
- **ID:** `iconify-preload-full-06`
- **Severity:** Medium
- **Category:** Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/iconify-preload/src/index.ts:161-174`
- **What:** When `totalProcessedIcons` reaches `maxTotalIcons` (default 1000) the loop `break`s out of the icon loop and then out of the set loop, logging a warning. The build still succeeds. Iteration order is `Object.keys(await lookupCollections())`, i.e. whatever order the collections index happens to have, so the icons that survive are not the ones you used most, they are the ones whose set sorted earlier.
- **Why it matters:** The failure mode is "some icons are missing in production", discovered visually, with the cause buried in build log line 162 among ~30 other `[iconify]` log lines. With `forceIncludeSets: true` and the default two sets the cap is reachable (2 × 200 forced icons plus whatever else is used).
- **Fix:** Make exceeding the cap an error by default (`throw`), or at minimum process *used* icons before forced full sets so truncation can only drop the discretionary ones, and print the names of the dropped icons.
- **Effort:** S
- **Blast radius:** `src/index.ts`; changes build behaviour from "succeeds incomplete" to "fails loudly", which is the point.

### [SEV-7] Icon scanning is hardcoded to `./src` and to five file extensions
- **ID:** `iconify-preload-full-07`
- **Severity:** Medium
- **Category:** Correctness | Design
- **Confidence:** High
- **Location:** `/Users/revenge/code/iconify-preload/src/utils/find.ts:58` and `:101-103`
- **What:** `findUsedIcons(targetDir)` takes `targetDir` only to know which file to *skip*; the actual scan root is the literal `if (fs.existsSync('src')) searchInDirectory('src')`, relative to `process.cwd()`. The extension filter is `/\.(jsx?|tsx?|css|scss)$/`, and `node_modules` and `dist` are skipped unconditionally.
- **Why it matters:** Icons referenced from `index.html`, `.md`/`.mdx` content, `.vue`/`.astro`, a sibling package in a monorepo, or from a component library inside `node_modules` are invisible, and the failure is silent (finding 06's warning does not fire; the icon simply has no rule). There is no option to add roots or extensions.
- **Fix:** Add `scanDirs?: string[]` and `extensions?: RegExp | string[]` options defaulting to today's behaviour, and resolve them against `process.cwd()` explicitly. Also allow an explicit `include: string[]` list of icon names as a safelist for the dynamic cases regex can never see.
- **Effort:** S
- **Blast radius:** `find.ts`, `index.ts` options interface, README table.

### [SEV-8] Prefix matching is a substring test, so unused icon sets get fully parsed
- **ID:** `iconify-preload-full-08`
- **Severity:** Medium
- **Category:** Performance
- **Confidence:** High
- **Location:** `/Users/revenge/code/iconify-preload/src/utils/find.ts:120-127`, used at `/Users/revenge/code/iconify-preload/src/index.ts:111-123`
- **What:** `hasIconsWithPrefix` returns true when any collected icon string `includes(prefix + '--')` **or** `includes(prefix + '-')`. Using `icon-[mdi-light--home]` therefore makes `hasIconsWithPrefix(icons, 'mdi')` true, because the string contains `mdi-`. The set then passes the gate and `JSON.parse(fs.readFileSync(jsonPath))` runs on the full `mdi` collection (several MB, ~7000 icons) before the per-icon exact check at `index.ts:133` rejects every one of them.
- **Why it matters:** Pure waste on every build: a multi-megabyte `JSON.parse` per falsely matched set, repeated on each `onBeforeBuild`. It also inflates `totalProcessedSets` accounting in the logs. The output is still correct, which is why it has never been noticed.
- **Fix:** Match on structure, not substrings. `index.ts:82-93` already parses `usedSets` into a `Map<setName, icons[]>`; iterate that map instead of iterating all ~200 collections, and drop `hasIconsWithPrefix` entirely.
- **Effort:** S
- **Blast radius:** `find.ts`, `index.ts` main loop. Also makes the `forceIncludeSets` path explicit rather than interleaved.

### [SEV-9] No caching or invalidation; regeneration happens once per build and never during dev
- **ID:** `iconify-preload-full-09`
- **Severity:** Medium
- **Category:** Performance | Correctness
- **Confidence:** Medium (the rsbuild hook ordering claim below is from the hook contract, not from a run)
- **Location:** `/Users/revenge/code/iconify-preload/src/index.ts:37-56`
- **What:** `generateIcons()` runs from `onBeforeBuild` and rewrites the whole CSS file every time; there is no content hash, no mtime check, no skip-if-unchanged. Separately, `modifyRspackConfig` performs file I/O as a side effect: it reads `targetDir/generated-icons.css` and `fs.copyFileSync`s it into a hardcoded `dist/styles/icons/` relative to `process.cwd()`, ignoring rsbuild's configured `distPath`, and it does this from a hook that can run more than once (per environment/target). The `if (!config.entry) { config.entry = {}; }` guard immediately above assigns an object that is then never used, i.e. dead code.
- **Why it matters:** (a) In `dev`, `onBeforeBuild` does not re-run per HMR cycle, so adding an icon requires a dev-server restart, with no message saying so. (b) The `dist/styles/icons/generated-icons.css` copy is an unhashed, uncacheable duplicate of CSS the app also `@import`s into its bundle (README lines 45-49), so consumers ship the icon payload twice unless they notice. (c) Writing files from a config-modification hook makes the plugin order-dependent in a way nothing documents.
- **Fix:** Hash the set of used icons plus the plugin options; skip regeneration when unchanged. Move the copy into `onAfterBuild` and resolve the destination from the rsbuild config rather than `process.cwd()`, or drop the copy entirely and rely on the documented `@import`. Delete the dead `config.entry` guard.
- **Effort:** M
- **Blast radius:** `src/index.ts`; the copy removal is potentially breaking for anyone who is loading the `dist/` copy directly rather than importing it.

### [SEV-10] README documents options that do not behave as described, and omits the one that matters
- **ID:** `iconify-preload-full-10`
- **Severity:** Low
- **Category:** Docs
- **Confidence:** High
- **Location:** `/Users/revenge/code/iconify-preload/README.md:36`, `:63-69`; code at `/Users/revenge/code/iconify-preload/src/index.ts:23-24`, `:109`, `:127`
- **What:** The README's options table lists `targetDir`, `includeSets`, `maxIconsPerSet`, `maxTotalIcons`, `compress`. It does not mention `forceIncludeSets`, which defaults to `false`, and `includeSets` is read **only** through `forceIncludeSets && includeSets.includes(iconSet)` (`index.ts:109`). So with the documented configuration, `includeSets` does nothing at all. The table further describes `includeSets` as "Icon sets to include completely", but when it is active the code takes `iconNames.slice(0, maxIconsPerSet)`, i.e. the first 200 icon names in object order, not the complete set.
- **Why it matters:** Someone configuring `includeSets` to guarantee a dynamically named icon is present gets no icons and no warning, or gets an arbitrary alphabetical prefix of the set and assumes coverage.
- **Fix:** Document `forceIncludeSets`; rename the `includeSets` description to "sets to include up to `maxIconsPerSet` icons from (requires `forceIncludeSets: true`)"; consider replacing both with an explicit `include: string[]` safelist of icon names, which is what the use case actually wants.
- **Effort:** S
- **Blast radius:** README, optionally the options interface.

<details>
<summary>Nits (iconify-preload)</summary>

- `src/utils/find.ts:10-22`: 11 regex patterns, of which patterns 6-11 (`className="…"`, `class='…'`, `'…'`, `"…"`) are all strictly subsumed by pattern 1 `/icon-\[([\w-]+)--([^\]]+)\]/g`. Only patterns 4-5 (`name="prefix--icon"`) add coverage. Every file is scanned 11 times to get 3 distinct results.
- `src/utils/find.ts:69-87`: the `else if (match.length >= 2)` branch is unreachable: every pattern has exactly two capture groups, so `match.length` is always ≥ 3.
- `src/utils/find.ts:6`, `:105-115`: `debugInfo` accumulates an object per match for the whole scan and is always printed, unconditionally, with no debug flag.
- `src/utils/find.ts:14-15`: `/name="([\w-]+)--([\w-]+)"/g` matches any JSX attribute called `name` whose value contains `--`, producing phantom icon entries (harmless, they just never resolve).
- `package.json`: no `exports` map, no `sideEffects`, no `type` field; `main`/`types` only. Fine for a build-time plugin, but inconsistent with the other two packages.
- `files: ["dist","README.md","LICENSE"]` is correct: no sources or tests leak into the tarball. No `postinstall`/`preinstall` scripts; the only lifecycle script is `prepublishOnly: npm run build`, which contradicts the AGENTS.md rule that bun is the package manager (`npm run` here will work, but it is the one npm invocation in a bun repo).
- No tests exist at all. For a package whose output is a text format with an easily-asserted shape (finding 01 would have been caught by one `expect(css).toContain('.icon-\\[')`), that is the highest-value missing test in this repo.
- All dependency names resolve to the intended packages (`@iconify/json`, `@iconify/utils`, `cssnano`, `postcss`, `postcss-cli`, `svgo` all verified against `bun.lock` integrity entries). No git-ref dependencies, no install scripts.
</details>

---

# Part 2: rsbuild-plugin-ui-css-purge (`@pathscale/rsbuild-plugin-ui-css-purge` 0.9.12)

**What it is:** a two-phase CSS purger. `generate-manifest.ts` runs in `@pathscale/ui` and produces `purge-manifest.json` from `*.classes.ts` files plus colocated component CSS. `postbuild-purge.ts` runs in the consumer after `rsbuild build`: it scans consumer source with SWC for `@pathscale/ui` imports and JSX, builds safelists, then walks every `dist/**/*.css` with PostCSS, drops selectors, drops keyframes/font-faces/variables, minifies with Lightning CSS, and **writes back over the original file**.

### How it decides a class is unused (the audit the brief asked for)

`selectorDecision` (`src/postbuild-purge.ts:224-255`) is the whole policy:

1. Extract class tokens from the selector, CSS-unescaping them (`:202-212`, so `.icon-\[mdi--cog\]` correctly becomes `icon-[mdi--cog]`).
2. **Zero classes → keep.** Element, id, and attribute-only selectors are never touched.
3. **Any class not present in the manifest → keep the whole selector.** This is the load-bearing rule and it is correct: Tailwind utilities, app classes, third-party classes are all unknown and therefore survive.
4. Otherwise, if no owning component is used → `remove-unused-component`.
5. If the selector carries a `data-`/`aria-` attribute → keep (runtime state).
6. Else every class must be in `classSafelist` → otherwise `remove-unused-variant`.

Dynamically constructed class names, template literals and `@pathscale/ui` variant maps are handled **indirectly but soundly**: the scanner never looks at class strings at all, it looks at component *usage*, and any prop it cannot resolve to a string literal degrades to `"DYNAMIC"` → `"ALL"` variants safelisted (`src/scan-consumer.ts:387-389`, `:503-516`), spreads likewise (`:496-497`), and an imported-but-not-directly-rendered binding produces a fully conservative usage (`:544-555`). Classes appearing only in markdown or HTML are **not** scanned (finding `ui-css-purge-full-05`), but they are only at risk if they collide with a manifest-owned class.

### Interaction with the 16 zero-CSS `@pathscale/ui` components (the brief's critical context)

Verdict: **the class purge does not endanger them, and I can show why.** Those components emit raw Tailwind utility strings from JS; utilities are excluded from the manifest by `isTailwindUtility` (`src/generate-manifest.ts:81-87`), so at purge time they hit rule 3 above and are kept. I checked the filter against reality rather than trusting the README: extracting every string token from all 92 `/Users/revenge/code/UI/src/components/**/*.classes.ts` files gives 912 tokens that survive the filter, and exactly 3 of them look remotely Tailwind-shaped (`noise-background__layer--0/1/2`, which are BEM). So today no utility is recorded as component-owned.

The residual mechanism is worth stating because it is the one way this becomes a High: `twPattern` is a hand-written prefix list, and it does **not** cover `divide-*`, `fill-*`, `stroke-*`, `overscroll-*`, `placeholder-*`. If a component ever puts `fill-current` or `divide-y` in its `CLASSES.base`, that utility becomes component-owned, and then `.fill-current` in the app's CSS is deletable whenever that component is unused, even though the consumer's own JSX uses `fill-current`, because the scanner never reads class strings. The filter's opposite error (`table`, `select`, `container`, `content`, `block`, `line` are all in `twPattern`, so a genuine component class with one of those names is dropped from the manifest) only causes under-purging, which is safe.

Note also that Tailwind v4 not scanning `node_modules` means those utilities are frequently **never generated into the CSS in the first place**; that is a `UI`-side problem, and this plugin neither causes nor detects it.

### Verifiability and build cost

Verifiability is the weak point: there is no `--dry-run`, no report-only mode, and no way to diff. The console report (`:505-532`) gives byte counts and removal counts but never names a removed selector, so "what did it delete" is unanswerable after the fact, and the original CSS is gone (`Bun.write(fullPath, purgedCss)` at `:534`). Cost is dominated by `cleanUnusedVarsWithReport`'s reparse loop (finding 07) and by `buildClassOwners` being rebuilt per CSS file (`:262-263`, plus `normalizePurgeDatabase` running a second time on an already-normalized database, since `main` passes the normalized object in at `:509`).

## Findings

### [SEV-1] `@keyframes` removal misreads Tailwind v4 and shorthand `animation` values, deleting live keyframes
- **ID:** `ui-css-purge-full-01`
- **Severity:** High
- **Category:** Correctness
- **Confidence:** High for the mechanism; High that a Tailwind v4 consumer hits it
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:304-324`
- **What:** `usedKeyframes` is built by walking `animation`/`animation-name` declarations and taking `part.trim().split(/\s+/)[0]`, i.e. the *first* token of each comma-separated part. Any `@keyframes` whose name is not in that set is removed. Two ways this is wrong:
  - **Tailwind v4.** `.animate-spin` is emitted as `animation: var(--animate-spin)` (the `animate` utility is `handle: o => [decl("animation", o)]` with `themeKeys: ["--animate"]`, and the theme value lives in `/Users/revenge/code/UI/node_modules/tailwindcss/theme.css:438` as `--animate-spin: spin 1s linear infinite`, with `@keyframes spin` at `theme.css:443`). The first token is the literal string `var(--animate-spin)`, so `spin` is never marked used and `@keyframes spin` is deleted. The `--animate-spin` variable itself survives (it *is* referenced by `var()`), so the CSS still says `animation: spin 1s linear infinite` with no keyframes to run.
  - **Shorthand order.** `animation: 1.5s linear infinite my-anim` is legal CSS; the name is last. The first token is `1.5s`.
- **Why it matters:** Spinners, skeletons and pulses stop animating in production with no build error and no visual diff in dev (dev does not run the purge). `nofilter.io` uses `animate-spin` 8 times and `animate-pulse` twice in `src/`, on Tailwind `^4.3.0` (`nofilter.io/package.json:92`), and declares this plugin at `package.json:46`. It does **not** currently invoke it (no purge step in any script in `nofilter.io/package.json`), so this is latent rather than live, but the first person to wire the postbuild step in gets frozen spinners.
- **Fix:** Resolve `var()` before name extraction, and parse the shorthand properly rather than positionally. Minimum viable version:
  ```ts
  // 1. build a map of custom property -> value from the same stylesheet
  // 2. expand var(--x) in animation values using that map (one level is enough in practice)
  // 3. take the token that is not a <time>, <timing-function>, <count>, or a known keyword
  ```
  Simpler and safer alternative: only remove a `@keyframes` when its name appears in **no** declaration value anywhere in the file, i.e. a raw substring guard on the whole stylesheet as a backstop. Cheap, and it turns a wrong deletion into a missed deletion.
- **Effort:** M
- **Blast radius:** one function; add tests covering `animation: var(--x)`, name-last shorthand, and comma-separated lists.

### [SEV-2] `@font-face` removal has the same defect and additionally cannot see cross-file usage
- **ID:** `ui-css-purge-full-02`
- **Severity:** High
- **Category:** Correctness
- **Confidence:** High for the mechanism; Medium that a current consumer hits it (no `@font-face` found in `nofilter.io/src` or `UI/src` today)
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:326-348`
- **What:** `usedFonts` is collected from declarations whose property matches `/^font(-family)?$/`. Tailwind v4's `font-sans` utility emits `font-family: var(--font-sans)`, and the theme value lives in a custom property (`--font-sans: …`, `tailwindcss/theme.css:2`) whose property name does **not** match `^font`. So the used-font set contains the string `var(--font-sans)` and not `Inter`, and any `@font-face { font-family: Inter }` in the same file is deleted. Font stacks written as `font-family: var(--brand-font), system-ui` fail identically.
- **Why it matters:** Web fonts silently stop loading; the page falls back to system fonts. This is exactly the class of regression that is noticed by a designer three weeks later.
- **Fix:** Same as finding 01: resolve `var()` against declared custom properties, and treat "font family name appears anywhere in the stylesheet text" as a keep-guard. Given that `@font-face` blocks are few and small, the honest option is to stop removing them at all: the win is tiny and the downside is a broken brand font.
- **Effort:** S (remove the sweep) or M (fix it properly)
- **Blast radius:** one function.

### [SEV-3] Every CSS file is purged in isolation, so any cross-file reference is invisible
- **ID:** `ui-css-purge-full-03`
- **Severity:** High
- **Category:** Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:495-535` (the `for await` loop), interacting with `:304-348` and `:388-435`
- **What:** `main` globs `dist/**/*.css` and runs the full pipeline (selector purge → var cleanup → minify → write) once per file, with no shared state between files apart from `runtimeCssVarRefs`. Keyframes, `@font-face` and custom properties are therefore evaluated against a single chunk. rsbuild emits one CSS file per entry and, with async chunks or multiple entries, several; the moment `@keyframes fade-in` lives in the shared chunk and `animation: fade-in …` lives in a route chunk, the keyframes are deleted.
- **Why it matters:** Turns findings 01 and 02 from "misparse" into "structurally cannot be right", and adds a third case (`:root{--brand:…}` in chunk A, `var(--brand)` in chunk B) where a perfectly parsed variable is still wrongly removed. Multi-entry and code-split apps are the normal case, not the exotic one.
- **Fix:** Two passes. Pass 1: read every CSS file, union the used keyframe names, font families, and `var()` references across all of them plus `runtimeCssVarRefs`. Pass 2: purge each file against the union. The selector purge itself is safely per-file and does not need this.
- **Effort:** M
- **Blast radius:** `main` restructured; `purgeCssWithDatabase`'s signature grows an optional "global facts" argument. Not a public API break if the argument is optional.

### [SEV-4] No safelist, no dry-run, and the tool overwrites `dist` in place
- **ID:** `ui-css-purge-full-04`
- **Severity:** High
- **Category:** Design | Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:30-54` (arg parsing), `:534` (`Bun.write(fullPath, purgedCss)`)
- **What:** `parseArgs` recognises exactly `--dist`, `--src`, `--manifest`. There is no `--safelist`, no `--safelist-file`, no `--dry-run`, no `--report`, no `--out`. When any of findings 01-03, 05 bites, the correct CSS has already been replaced by the wrong CSS in the build output, and the report cannot tell you what was lost because it only prints counts.
- **Why it matters:** This is the escape hatch that makes every other finding survivable. Every mature purger has one (PurgeCSS `safelist`, Tailwind `@source inline(...)`) precisely because static analysis of a dynamic language is always incomplete. Without it, the only remedy for a wrong purge is to stop using the tool.
- **Fix:** Three small additions, in this order of value:
  1. `--safelist <glob-or-regex>` (repeatable) and `--safelist-file <path>`, applied in `selectorDecision` before any removal decision.
  2. `--dry-run` that runs everything and writes the report without calling `Bun.write`, plus `--report <path>` emitting the list of removed selectors, keyframes, font-faces and variables (not just counts).
  3. A magic comment guard, `/* css-purge-keep */` on a rule, honoured by the walker.
- **Effort:** M
- **Blast radius:** CLI surface only; additive.

### [SEV-5] Consumer scanning is import-driven and misses whole categories of usage
- **ID:** `ui-css-purge-full-05`
- **Severity:** Medium
- **Category:** Correctness
- **Confidence:** High for the mechanisms; Medium for real-world impact today (nofilter.io actively bans barrel imports, which is what would trigger the worst case)
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/scan-consumer.ts:520-559`, plus `:232-244`
- **What:** Three gaps compound:
  - `if (!code.includes("@pathscale/ui")) continue;` (`:528`). A file that renders `<Button>` imported from a local re-export barrel (`~/components/ui`) contains no such string and is skipped entirely. Every component reached only through such a barrel is classified unused.
  - `export * from "@pathscale/ui"` records **nothing**: `ExportAllDeclaration` handling (`:232-244`) only produces a conservative usage when `componentFromDeepImport(source)` returns non-null, which it does not for the bare package specifier. A one-line `src/ui.ts` re-export barrel therefore purges the entire library's CSS.
  - The glob is `**/*.{tsx,ts,jsx,js}` (`:522`). `index.html`, `.md`/`.mdx`, `.vue`, `.astro`, and any class name written as a plain string (`class="drawer"` in hand-written markup) are never seen. Combined with rule 3 of `selectorDecision`, this only bites when the literal collides with a manifest-owned class, but `drawer`, `badge`, `card`-style names are exactly the ones that collide.
- **Why it matters:** The failure is total for a given component (all of its selectors go), silent, and only visible in a production build. `nofilter.io/src/scripts/checkBarrelImports.ts` currently enforces deep imports, which happens to keep the scanner honest, but that is a convention in a different repo, not a property of this tool.
- **Fix:** Drop the `code.includes` fast path (SWC parse of a few hundred files is not the bottleneck; the reparse loop in finding 07 is). Treat `export * from "@pathscale/ui"` as "every component in the manifest is used". Add `--extra-content <glob>` scanned for bare class-name literals against manifest-known classes only, which is cheap and closes the HTML/markdown hole.
- **Effort:** M
- **Blast radius:** `scan-consumer.ts`; strictly less purging, so no consumer breaks.

### [SEV-6] Half of the manifest is generated, shipped, and never read
- **ID:** `ui-css-purge-full-06`
- **Severity:** Medium
- **Category:** AI-smell | Design | Performance
- **Confidence:** High (grep-verified in both directions)
- **Location:** producers `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/generate-manifest.ts:210-460` and `:485-542`; consumers (none) `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:96-105`
- **What:** `normalizePurgeDatabase` faithfully copies `selectors`, `attributeSelectors`, `cssVars` and `keyframes` into every normalized record, and nothing in the purger ever reads them again: the only occurrences of those names in `postbuild-purge.ts` are the interface declaration and the normalizer itself. The whole `db.shared` index (`updateShared`, 58 lines) has zero readers. `safelists.attrSafelist` appears only inside a `console.log` (`:485`); `safelists.dynamicComponents` appears nowhere outside its own construction. Producing those unread fields costs ~300 lines of Lightning CSS selector reconstruction (`stringifySelector`, `stringifyNth`, `OperatorMap`, `CombinatorMap`, `WSElementMap`, plus the `// TODO: use ToCSS from napi-rs module | …` at `:385` admitting the approach is wrong), and `createRecord` (`:462-483`) hands the **same** `cssFacts` object to every part of a compound component, so a component with 8 parts stores its full selector list 8 times in the JSON.
- **Why it matters:** This is the largest, most fragile, most-TODO'd part of the codebase and it has no effect on output. It is also the part a future maintainer will assume the purge depends on. Meanwhile the checks that *would* benefit from manifest facts (keyframes and CSS vars, findings 01-03) implement their own ad-hoc parsing instead.
- **Fix:** Either delete the CSS-facts half of `generate-manifest.ts` and shrink the manifest to `{version, components: {key: {classes, attrs, deps}}}`, or wire it in: `record.keyframes.declared`/`referenced` and `record.cssVars` are precisely the ownership data findings 01 and 03 need. Choose one; do not leave it half-connected. Also delete `dynamicComponents` or use it.
- **Effort:** M (delete) / L (wire in)
- **Blast radius:** manifest schema version bump, `@pathscale/ui`'s `postbuild:manifest` script, and the `PurgeDatabaseV2` type exported from `index.ts`. Keep `normalizePurgeDatabase`'s tolerance for old manifests and nothing breaks at runtime.

### [SEV-7] The variable cleanup re-parses the entire stylesheet on every fixpoint iteration
- **ID:** `ui-css-purge-full-07`
- **Severity:** Medium
- **Category:** Performance
- **Confidence:** High
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:387-435`
- **What:** `cleanUnusedVarsWithReport` loops `while (changed)`, and each iteration does a full `postcss.parse(result)`, two full walks, and a full `root.toString()`. The number of iterations is the depth of the variable dependency chain: removing `--a` can orphan `--b` which orphans `--c`. The author flagged it: `// TODO: potentially reduce parsing amount` at `:387`.
- **Why it matters:** On a Tailwind v4 app the theme layer alone declares hundreds of custom properties with multi-level `var()` chains, over a stylesheet in the hundreds of KB. Parse + stringify of a 500 KB stylesheet is roughly 50-100 ms, so a chain depth of 10 costs a second per CSS file, per build, for a byte saving that Lightning CSS partially achieves anyway.
- **Fix:** Parse once. Build a `declared: Map<name, decl[]>` and a `referencedBy: Map<name, Set<name>>` graph in a single walk, then compute reachability from the external roots (`externallyReferencedVars` plus every var referenced from a non-custom property) and remove everything unreachable in one pass. No re-parse, no fixpoint.
- **Effort:** M
- **Blast radius:** one function; the exported `cleanUnusedVars`/`cleanUnusedVarsWithReport` signatures are unchanged.

### [SEV-8] CSS variables read from JavaScript at runtime are only detected through a `var(` regex
- **ID:** `ui-css-purge-full-08`
- **Severity:** Medium
- **Category:** Correctness
- **Confidence:** Medium (the mechanism is certain; I could not find a consumer that currently loses a variable)
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:365-378`
- **What:** `collectRuntimeCssVarRefs` scans `dist/**/*.{js,mjs,cjs}` for `/var\(\s*(--[\w-]+)/g` only. A variable read through `getComputedStyle(el).getPropertyValue("--nf-accent")` or via a string constant used with `setProperty` produces no `var(` text and is invisible.
- **Why it matters:** `nofilter.io/src/features/studio/utils/canvas/canvasHelpers.ts:111-125` does exactly this, reading `--nf-accent`, `--nf-surface-3`, `--nf-on-accent`, `--nf-text` to paint a canvas. I checked each: all four are also referenced by `var()` inside CSS in that repo (4, 4, 4 and 11 references respectively), so they would survive today. The next theme token that is declared for JS consumption only will not.
- **Fix:** Widen the dist-JS scan to also collect `--[a-zA-Z][\w-]*` appearing inside string literals, which over-collects harmlessly (an unused variable surviving costs bytes, a used one being removed costs a bug). Alternatively require such tokens to be listed in the `--safelist` from finding 04.
- **Effort:** S
- **Blast radius:** one function; strictly less removal.

### [SEV-9] Packaging: a `.ts` bin with no shebang, and a bundled native dependency
- **ID:** `ui-css-purge-full-09`
- **Severity:** Low
- **Category:** Maintainability
- **Confidence:** High for the bin, Medium for the pnpm case (not reproduced)
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/package.json` (`bin`, `files`), `/Users/revenge/code/rsbuild-plugin-ui-css-purge/build.ts:1-8`
- **What:** `bin` declares `"generate-manifest": "src/generate-manifest.ts"`, a raw TypeScript file whose first line is `/**`, with no shebang and no build step. npm/bun will create a shim pointing at it; executing that shim outside Bun fails. In practice nobody uses it: `UI/package.json:128` invokes the file by path through `bun run`. Separately, `build.ts` externalises `postcss` and `@swc/core` but not `lightningcss`, so lightningcss's JS wrapper is inlined into `dist/postbuild-purge.js` while its native binding is still loaded through a runtime template `require(\`lightningcss-${...}\`)` (confirmed in the published artifact at `UI/node_modules/@pathscale/rsbuild-plugin-ui-css-purge/dist/postbuild-purge.js`). That resolves fine under hoisted npm/bun layouts because the platform package sits in the same `node_modules` root; under pnpm's isolated store it would not be visible from the bundled file's location.
- **Why it matters:** Low impact today, but the bin entry is a published API surface that does not work, and the bundling choice is an install-layout landmine.
- **Fix:** Either compile `generate-manifest.ts` into `dist` with a `#!/usr/bin/env bun` shebang and point `bin` at it, or drop the `bin` entry and document the `bun run node_modules/...` invocation the way `UI` already uses it. Add `lightningcss` to `external` in `build.ts`.
- **Effort:** S
- **Blast radius:** `package.json`, `build.ts`; `files` would no longer need to ship `src/generate-manifest.ts`.

### [SEV-10] The manifest generator imports and executes library source
- **ID:** `ui-css-purge-full-10`
- **Severity:** Low
- **Category:** Security
- **Confidence:** High
- **Location:** `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/generate-manifest.ts:579`
- **What:** `const mod = await import(fullPath)` on every `**/*.classes.ts` under the given directory. Anything at module scope in those files runs during manifest generation.
- **Why it matters:** It is the library's own first-party code, so the realistic risk is low, but it means the build step's blast radius is "arbitrary code from `node_modules/@pathscale/ui`" rather than "read some files". A `*.classes.ts` that imports the component (and hence the whole SolidJS tree) also makes generation slow and can fail on DOM-only code.
- **Fix:** Acceptable as-is if documented. If it needs hardening, parse the `CLASSES` export with SWC (already a dependency) rather than importing it, which also removes the "must be a plain object literal" implicit contract.
- **Effort:** M
- **Blast radius:** `generate-manifest.ts` only.

### Tests

`tests/purge.test.ts` is the strongest test file of the three repos: 10 tests, real assertions on real behaviour, including a genuine end-to-end run of the CLI in a temp directory that asserts `stderr === ""` and checks the rewritten file (`:194-243`). No mock-asserting, no `expect(true)`.

The gap is that it tests only the part that works. There is **no** test for `removeUnusedKeyframes`, `removeUnusedFontFaces`, multi-file dist directories, `collectRuntimeCssVarRefs`, or `var()`-indirected values, precisely findings 01, 02, 03 and 08. Three small tests (a `@keyframes spin` + `animation: var(--animate-spin)` fixture, a two-file dist where the keyframes and the usage are split, and a `@font-face` + `font-family: var(--font-sans)` fixture) would each fail today.

<details>
<summary>Nits (rsbuild-plugin-ui-css-purge)</summary>

- `src/postbuild-purge.ts:262`: `main` already normalized the database at `:464`, then passes it to `purgeCssWithDatabase`, which normalizes it again, once per CSS file. `buildClassOwners` is likewise rebuilt per file.
- `src/postbuild-purge.ts:349-361`: `removeEmptyAtRules` loops `while (cleaned)` over the whole tree; a single bottom-up pass would do. Removing empty `@layer` blocks can also change cascade-layer order for whatever remains, which is unlikely to matter but is undocumented.
- `src/postbuild-purge.ts:446-454`: `minify` uses `errorRecovery: true`, so a stylesheet Lightning CSS cannot parse is silently partially dropped rather than failing the build. Same flag at `generate-manifest.ts:285`.
- `src/generate-manifest.ts:193-198`: `isCompound` returns true for any `CLASSES` object with no known slot key, so a simple component using only custom slot names (`{wrapper, icon}`) is silently split into `Component.wrapper` / `Component.icon` records.
- `src/generate-manifest.ts:638`: the dependency regex `/from\s+["']\.\.\/([^/"']+)/g` only sees single-level relative imports; `../../foo/bar` and aliased imports produce no `deps`, so `expandDependencyUsages` under-expands.
- `src/scan-consumer.ts:563-604`: `main` is a second CLI entry point in a file that is also a library module, duplicating the reporting logic in `postbuild-purge.ts`'s `main`. It is not exposed via `bin`, so it is reachable only by path.
- `package.json`: `files: ["dist", "src/generate-manifest.ts"]`: tests do not leak, one source file does, deliberately. `exports` is correct and types resolve. No `sideEffects` field (the package is a CLI, so it is moot). No install scripts; `@swc/core` and `lightningcss` both have their own native postinstall behaviour via optional platform packages, which is normal for them. All three dependency names resolve to the intended packages.
- `bunfig.toml` sets `frozen = true` for installs, which is the right default and worth copying to the other two repos.
</details>

---

# Part 3: wss-adapter (`@pathscale/wss-adapter` 2.0.11)

**What it is:** a singleton WebSocket client for the pathscale JSON-RPC-ish protocol. `configure()` builds a per-service `connect/disconnect/isOpen` adapter plus a `Proxy` that turns `wssAdapter.sessions.app.SomeMethod(params)` into a `{method, seq, params[]}` frame. Responses are correlated by `seq` through `store.pendingPromises`; `type: "Stream"` frames are fanned out to `store.subscriptions` and to `subscribeTo` observers.

## Findings

### [SEV-1] The subscription API consumers actually need does not exist, so six hooks hand-manage private state
- **ID:** `wss-adapter-full-01`
- **Severity:** High
- **Category:** Design
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:22-52` (`subscribeTo` machinery), `:428-453` (stream dispatch), `:121-141` (`store.subscriptions`); consumers `/Users/revenge/code/nofilter.io/src/hooks/studio/useSubWaitRoomHostEvents.ts:54-128`, `.../useSubWaitRoomGuestEvents.ts:51-61`, `.../useSubSessionEvents.ts`, `.../useSubCallQualityEvents.ts`, `/Users/revenge/code/nofilter.io/src/hooks/support/useSubSupportChatEvents.ts:33-110`, `/Users/revenge/code/nofilter.io/src/hooks/supportCafe/useSupportCafeSubscribeEvents.ts:91-97`
- **What:** A public `subscribeTo(event, observer)` exists (added in `62ed276`), yet all six subscription hooks in nofilter.io bypass it and write directly into `wssAdapter.__store.subscriptions[service][methodCode]`. Reading them shows exactly why, and each reason is a missing capability rather than consumer laziness:
  1. **No service scoping.** `streamSubscribers` is a single global map keyed by event string, and `getStreamEventKeys` (`:89-104`) resolves a method code against **every** configured service's method table. Two services sharing a numeric method code cross-deliver. `useSupportCafeSubscribeEvents` needs `supportCafe`, not `app`.
  2. **A fixed, lossy payload extractor.** `getStreamPayload` (`:106-119`) unwraps `data.data` → `data` → `params` → raw. The consumers need the envelope: `useSubWaitRoomHostEvents:64-70` wants `response.data` only when it is an array, `useSubSupportChatEvents:33-43` wants an array or `[]`, `useSupportCafeSubscribeEvents` has its own `extractStreamPayload`. Three extractors have drifted because the library's one is not overridable.
  3. **No subscribe/unsubscribe lifecycle.** The server-side stream is opened and closed by ordinary RPC calls (`api.app.SubWaitRoomHostEvents({unsub:false})` / `{unsub:true}`). The adapter has no concept of this, so every hook re-implements request, cleanup, and the "socket already dead, ignore this failure" special case (`useSubWaitRoomHostEvents.ts:27-30` pattern-matches the library's own error *message strings* to detect it, which is as brittle as it sounds).
  4. **No reconnect story.** On close the adapter calls `complete()` on every observer (`:77-87`) and drops nothing, so a consumer that treats `complete` as terminal is dead after the first blip and one that does not gets no signal to re-issue its subscribe request.
  5. **Single handler per method.** `store.subscriptions[svc][code] = handler` is a plain assignment: two components subscribing to the same event silently clobber each other. `subscribeTo` gets this right; the path everyone uses does not.
- **Why it matters:** 906 lines of duplicated subscription plumbing across one consumer repo, three divergent payload extractors (so a protocol change must be found in three places), error handling done by regex over error messages, and a hard dependency on a field named `__store` that the package is free to change in a patch release. It also means the library cannot fix findings 03-06 below without breaking consumers, because they hold the internals.
- **Fix:** Ship one primitive that covers all five needs, and make `__store` non-public (finding 02). Concrete shape:

  ```ts
  // types.ts
  export interface StreamSubscription {
    /** "idle" | "subscribing" | "live" | "error" | "closed" */
    state: () => StreamState;
    unsubscribe: () => Promise<void>;
  }

  export interface StreamSubscribeOptions<TRaw = unknown, TEvent = TRaw> {
    service: ServiceName;               // scoping: fixes (1)
    event: string | number;             // method code or configured method name
    select?: (raw: TRaw) => TEvent | undefined;  // fixes (2); undefined = drop this frame
    onData: (event: TEvent) => void;
    onError?: (err: WssServiceError) => void;
    onStateChange?: (state: StreamState) => void;
    /** RPCs that open and close the server-side stream; fixes (3) and (4) */
    lifecycle?: {
      subscribe: () => Promise<unknown>;
      unsubscribe: () => Promise<unknown>;
    };
    /** default true: re-issue lifecycle.subscribe after a reconnect instead of completing */
    resubscribeOnReconnect?: boolean;
  }

  // wss-adapter.ts
  wssAdapter.subscribeStream = <TRaw, TEvent>(
    options: StreamSubscribeOptions<TRaw, TEvent>,
  ): StreamSubscription => { /* … */ };
  ```

  Semantics the implementation must guarantee: (a) subscribers are keyed by `(service, resolvedMethodCode)` and stored in a `Map<key, Map<id, entry>>`, so N subscribers per event; (b) `select` defaults to identity on the raw envelope, never to today's unwrapping heuristic; (c) `lifecycle.subscribe` is called on creation and again after a reconnect when `resubscribeOnReconnect`, with failures surfaced through `onStateChange("error")` + `onError`, not thrown; (d) `unsubscribe()` calls `lifecycle.unsubscribe` and swallows "socket already gone" itself, which is the special case every hook currently reimplements; (e) `complete` disappears as a concept, replaced by `onStateChange`.

  The `useSubWaitRoomHostEvents` hook (136 lines) then becomes roughly:
  ```ts
  const sub = wssAdapter.subscribeStream<StreamEnvelope, WaitRoomEvent[]>({
    service: "app",
    event: 41017,
    select: (r) => (Array.isArray(r?.data) ? r.data : Array.isArray(r?.data?.data) ? r.data.data : undefined),
    onData: (rows) => { setData(rows); setIsLoading(false); },
    onError: setError,
    lifecycle: {
      subscribe: () => api.app.SubWaitRoomHostEvents({ unsub: false, sessionId: params.sessionId }),
      unsubscribe: () => api.app.SubWaitRoomHostEvents({ unsub: true, sessionId: params.sessionId }),
    },
  });
  onCleanup(() => void sub.unsubscribe());
  ```
  Roughly 25 lines, no `__store`, no message-string matching, one payload extractor per stream instead of three shared across streams.

  Also add the connection-state accessor that `nofilter.io/src/services/serviceStore.ts:91` currently gets by reading `__store.sessions[svc].readyState`: `wssAdapter.services[svc].state()` returning `"closed" | "connecting" | "open" | "closing"`, plus `onStateChange`. `isOpen()` alone is not enough, which is exactly why that file reaches inside.
- **Effort:** L for the library (a day), M per consumer hook, and it deletes far more than it adds.
- **Blast radius:** additive on the library side (`subscribeTo` can remain, deprecated, implemented on top of `subscribeStream`). Removing `__store` afterwards is the breaking part and should be a major version with the six hooks migrated first.

### [SEV-2] `__store` is a documented public field exposing the raw socket and all pending promises
- **ID:** `wss-adapter-full-02`
- **Severity:** High
- **Category:** Security | Design
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/types.ts:74-83` (`IWssAdapter.__store: IStore`), `/Users/revenge/code/wss-adapter/src/types.ts:31-52` (`IStore.sessions: Record<string, WebSocket>`), `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:515`; introduced deliberately in commit `a308d74` "expose __store on IWssAdapter interface for typed access"
- **What:** The store is assigned onto the exported singleton and typed on the public interface. It contains the live `WebSocket` per service, the full `pendingPromises` map (every in-flight `resolve`/`reject`), the error catalog, and the subscription table.
- **Why it matters:** Any code sharing the module graph, including a compromised transitive dependency, can `wssAdapter.__store.sessions.app.send(...)` to forge requests as the authenticated user, `.close()` to deny service, read `.protocol` to recover the negotiated subprotocol (which, per finding 05, is where consumers put the access token), or hijack `pendingPromises[n].resolve` to feed a caller attacker-chosen data. Every invariant the adapter enforces (sequence allocation, timeout bookkeeping, readyState checks) is bypassable, so the package cannot make guarantees about its own behaviour. The `__` prefix is a naming convention, not access control, and putting it on the public interface makes it a supported API.
- **Fix:** Provide the legitimate uses as real API (finding 01: subscriptions and connection state) and then remove `__store` from `IWssAdapter`. In the interim, at minimum narrow the exposed type so `sessions` is not handed out: expose `__store` as `Omit<IStore, "sessions" | "pendingPromises">` and add `services[svc].state()`.
- **Effort:** M (after finding 01 lands)
- **Blast radius:** breaking for the six nofilter.io hooks plus `serviceStore.ts`; major version.

### [SEV-3] `pendingPromises` is global, so one service's disconnect rejects every other service's in-flight calls
- **ID:** `wss-adapter-full-03`
- **Severity:** Medium
- **Category:** Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:149-157`, called from `:278-280` (`onclose`) and `:305-307` (`disconnectHandler`)
- **What:** `store.pendingPromises` is keyed by `seq` only, with no service dimension, and `rejectPendingPromises` iterates the entire map. When service `supportCafe`'s socket closes, every in-flight `app` request is rejected with `"<method>: WebSocket closed (code 1006)"` even though the `app` socket is healthy. `store.sequence` is likewise a single global counter shared by all services.
- **Why it matters:** nofilter.io configures both `app` and `supportCafe`. A support-chat socket blip surfaces as spurious failures across unrelated feature calls, and the error message names the wrong cause, so it is near-undiagnosable from a bug report.
- **Fix:** Key pending promises by `(serviceName, seq)`, either `Record<string, Record<number, Executor>>` or a composite string key, and have `rejectPendingPromises(serviceName, reason)` touch only that service. Same for the sequence counter, which should be per service.
- **Effort:** S
- **Blast radius:** `wss-adapter.ts` internals plus the `IStore` type (which is public today, see finding 02).

### [SEV-4] Timed-out requests are never removed from `pendingPromises`
- **ID:** `wss-adapter-full-04`
- **Severity:** Medium
- **Category:** Performance | Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:362-369`
- **What:** The timeout callback is `setTimeout(() => { reject(new Error(\`${methodName} took too long, aborting\`)); }, store.timeout)`. It rejects but never does `delete store.pendingPromises[payload.seq]`. Compare `receiveHandler`'s success path (`:414-421`) and `onError` (`:494-500`), which both delete.
- **Why it matters:** Every timed-out request leaks an entry holding a `resolve`, a `reject`, and a stale timer id, for the lifetime of the page. On a flaky connection with a long-lived session (a video studio tab open for hours) this grows without bound, and each subsequent `rejectPendingPromises` walks the accumulated corpses and calls `reject` on already-settled promises. If a late response for that seq eventually arrives, `resolve` is called on a settled promise (a silent no-op that hides the fact that the response arrived at all).
- **Fix:** `delete store.pendingPromises[payload.seq]` inside the timeout callback before rejecting.
- **Effort:** S (one line)
- **Blast radius:** one function.

### [SEV-5] No TLS enforcement, and `connect()` accepts a caller-supplied endpoint while credentials ride in the subprotocol
- **ID:** `wss-adapter-full-05`
- **Severity:** Medium
- **Category:** Security
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:203-234` (`connectHandler`, `new WebSocket(remote || serviceConfig.remote, protocols)`), `:210-213` (the protocols requirement), `/Users/revenge/code/wss-adapter/README.md:40`
- **What:** Three related gaps:
  - The URL scheme is never checked. `ws://` connects silently; there is no warning, no opt-in flag, nothing that distinguishes `wss://api.example.com` from `ws://api.example.com` in the config.
  - `connect(payload, remote)` lets any caller override the configured endpoint per call. The override is not validated against an allow-list or against the configured host.
  - `connect` **requires** an array payload ("WebSocket protocols required for authentication") and passes it straight to the `WebSocket` constructor's `protocols` argument, i.e. into the `Sec-WebSocket-Protocol` request header. Consumers put credentials there: `web3.trading/src/services/authServices.ts:121` sends `["0init", \`1${accessToken}\`]`, and `nofilter.io/src/hooks/supportCafe/useSupportCafeAppConnect.ts:24-28` sends app and user identifiers the same way. The password path in the family (`encodePassword` in `utils/encoders.ts`, flagged repo-wide) exists precisely to make credentials header-safe for this channel.
  - Browsers do no certificate or origin validation you can influence from here, so the only defence available at this layer is the scheme check and the endpoint allow-list, and neither exists.
- **Why it matters:** Combining an unvalidated `remote` with credentials in the handshake header means anything that can influence the endpoint (a settings page, a URL parameter, a config fetched at runtime; `web3.trading` and `pathscale.com` both ship a `ConnectionSettingsPage`) can redirect a fully credentialed handshake to an attacker host. Over `ws://` the token is on the wire in cleartext. Subprotocol values also land in proxy and server access logs far more readily than a message body does, and they are visible in devtools' network pane on the handshake row.
- **Fix:** (a) Throw on a non-`wss:` URL unless the host is `localhost`/`127.0.0.1` or an explicit `allowInsecure: true` option is set. (b) Validate `remote` against the configured origin, or drop the parameter, since nothing in the reviewed consumers uses it. (c) Document the subprotocol auth convention explicitly in the README, including the constraint that values must be valid HTTP tokens (no spaces, no non-ASCII, or the `WebSocket` constructor throws `SyntaxError`), and validate them before constructing the socket so the failure is a clear error rather than a DOM exception.
- **Effort:** S for (a) and (c), M for (b) including consumer checks.
- **Blast radius:** `connectHandler` plus README; (a) could break a local development setup using `ws://`, which is what the escape hatch is for.

### [SEV-6] Every stream frame is logged to the console in production
- **ID:** `wss-adapter-full-06`
- **Severity:** Medium
- **Category:** Security | Performance
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:429`
- **What:** `console.log("Stream response:", response);` runs unconditionally at the top of the `type === "Stream"` branch, before any dispatch. `:295` also logs the raw error event. There is no log-level concept in the package.
- **Why it matters:** Stream payloads are business data: chat messages, session events, wait-room participant lists. In a live session these arrive continuously, so this is both a privacy leak into whatever collects browser console output (the family ships a third-party log sink, per the cross-repo pattern list) and a measurable performance cost, since `console.log` of a large object retains it for devtools inspection and blocks on serialization when a console is attached.
- **Fix:** Delete the log, or gate it behind an opt-in `debug` flag on `IConfiguration` that defaults to false.
- **Effort:** S
- **Blast radius:** one line.

### [SEV-7] `JSON.parse` is unguarded in both message handlers
- **ID:** `wss-adapter-full-07`
- **Severity:** Medium
- **Category:** Correctness | Security
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:237-238` and `:401-402`
- **What:** Both `connectHandler`'s bootstrap `onmessage` and `receiveHandler` do `const response = JSON.parse(event.data)` with no try/catch. The handler's type is `(event: { data: string })`, but a WebSocket delivers `Blob`/`ArrayBuffer` for binary frames, so a single binary or malformed frame throws inside the event handler.
- **Why it matters:** An exception inside `onmessage` propagates as an uncaught error; the frame is lost, nothing is rejected, and any request awaiting that seq hangs until its timeout (and then leaks per finding 04). During the connect handshake the `connect()` promise never settles at all if the malformed frame arrives before the auth response. A hostile or merely buggy server turns one bad frame into a stuck client. There is also no message-size guard anywhere: a multi-hundred-MB text frame is parsed into memory unconditionally.
- **Fix:** Wrap both parses; on failure, log once and (for `receiveHandler`) ignore the frame, and for the connect handshake `reject` with a clear error. Optionally add a `maxMessageBytes` option checked against `event.data.length` before parsing.
- **Effort:** S
- **Blast radius:** two functions.

### [SEV-8] `onError` throws from inside the socket message handler when nothing is waiting
- **ID:** `wss-adapter-full-08`
- **Severity:** Medium
- **Category:** Correctness
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:465-513`, specifically `:512`
- **What:** After trying the pending promise for `response.seq` and then the stream subscribers for `response.method`, `onError` ends with `throw new Error("Unknown request failed")`. Its only caller is `receiveHandler` (`:424`), which is a WebSocket `onmessage` handler, so the throw escapes into the event loop as an uncaught exception. It fires whenever a server error arrives for a request that already timed out, or for a stream with no current subscribers, both ordinary situations.
- **Why it matters:** Uncaught exceptions in production, error-reporting noise, and the original error's information is discarded and replaced with a message that says nothing.
- **Fix:** Replace the throw with a single `console.warn` (or route it to `store.onError`) carrying the actual `serviceError`.
- **Effort:** S
- **Blast radius:** one function.

### [SEV-9] `decreaseSeq` can hand out a sequence number that is still in flight
- **ID:** `wss-adapter-full-09`
- **Severity:** Medium
- **Category:** Correctness
- **Confidence:** Medium (the mechanism is clear; the interleaving needs two services or a queued-plus-open mix, and I did not reproduce it at runtime)
- **Location:** `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:129-138` (the counter), `:358`, `:383`, `:388`, `:395` (the four `decreaseSeq` call sites)
- **What:** Sequence numbers come from a single global counter that is incremented on allocation and **decremented** whenever a send fails. Allocation is monotonic, so a decrement is only safe if the allocation being undone is the highest outstanding one. It is not always: request A can allocate seq 2 and sit queued on service X's `CONNECTING` socket, request B can allocate seq 3 on service Y's open socket and be stored in `pendingPromises[3]`, and then X's socket errors, running A's `onErr` → `decreaseSeq()` → counter is 2. The next allocation returns 3, which overwrites B's live entry in `pendingPromises`.
- **Why it matters:** The response intended for B resolves C's promise, delivering one caller's data to another caller. B then fails via timeout with a misleading message. Given finding 03 (one global counter and one global map for all services), this is reachable in any app with two configured services, which nofilter.io is.
- **Fix:** Never decrement. A monotonically increasing counter with gaps is correct and costs nothing; delete `decreaseSeq` and its four call sites. Combine with finding 03's per-service keying.
- **Effort:** S
- **Blast radius:** `wss-adapter.ts` plus the `IStore` public type (`sequence.decreaseSeq`).

### [SEV-10] The `biome` devDependency is not Biome, so lint has never run; `bun test` is stubbed out over a real test file
- **ID:** `wss-adapter-full-10`
- **Severity:** Medium
- **Category:** Maintainability | Security
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/package.json:22-23`, `:60`; `/Users/revenge/code/wss-adapter/bun.lock:112`; `/Users/revenge/code/wss-adapter/biome.json:2`; `/Users/revenge/code/wss-adapter/src/errors.test.ts`
- **What:** Three compounding problems:
  - `"biome": "^0.3.3"` resolves to `biome@0.3.3`, which the lockfile shows depends on `bluebird`, `chalk@^1`, `commander@^2.9`, `editor`, `fs-promise`, `inquirer-promise`, `request-promise`, `untildify`, `user-home`: a 2016-era unrelated CLI, not the Rust-based Biome toolchain, which is published as `@biomejs/biome` (correctly used by the other two repos in this review). `request-promise` is itself deprecated. So `bun run lint` / `bun run format` (`biome check .` / `biome format .`) invoke the wrong binary; they cannot have been checking this code.
  - `biome.json` uses `"schema"` rather than `"$schema"`, pins schema `1.9.4`, and uses the v1-only `files.ignore` key. Even with the right dependency, the config would need updating for the v2 line the sibling repos use.
  - `"test": "echo 'Tests coming soon'"` while `src/errors.test.ts` contains 8 real `bun:test` cases with meaningful assertions (message-selection order, no `[object Object]`, `instanceof Error` survival after transpile). They are written, they are good, and they never run.
- **Why it matters:** A dependency name that silently resolves to an unrelated abandoned package is the exact shape of a typo-squat, whether or not this one is malicious, and it drags a deprecated HTTP stack into the dev tree. The lint gate that the AGENTS.md workflow assumes exists does not. And the one test file in the repo is disabled by a placeholder script, so a regression in `buildServiceError` (the newest feature, commit `81f2b24`) would ship unnoticed.
- **Fix:** Replace `biome` with `@biomejs/biome` at the version the sibling repos use, port `biome.json` to the v2 schema (`$schema`, `files.includes`), set `"test": "bun test"`, and run both. Verify what the lint actually reports before assuming it is clean.
- **Effort:** S, plus however much the first real lint run surfaces.
- **Blast radius:** dev tooling only; no runtime effect.

### [SEV-11] The service name type is hardcoded to a single service the consumers do not use exclusively
- **ID:** `wss-adapter-full-11`
- **Severity:** Low
- **Category:** Design
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/src/types.ts:68-72`
- **What:** `export type ServiceName = "app";` and `export type ApiMethods = { app: Record<string, (params?: any) => Promise<any>> };`, while `configure()` happily accepts `services: Record<string, IServiceConfig>` and writes into `wssAdapter.services[serviceName as ServiceName]` with a cast (`wss-adapter.ts:170-172`).
- **Why it matters:** nofilter.io configures a `supportCafe` service, so its hook must cast through `unknown` to reach it (`useSupportCafeSubscribeEvents.ts:91`). The type lies about the runtime capability, and the cast that works around it is precisely what defeats type-checking on the store shape.
- **Fix:** Make the adapter generic over its service map, or at minimum widen `ServiceName` to `string` and type `sessions` as `Record<string, Record<string, (params?: unknown) => Promise<unknown>>>`. The generic version (`configure<S extends Record<string, IServiceConfig>>(config): TypedAdapter<S>`) is the version that would actually give consumers method-name completion.
- **Effort:** M
- **Blast radius:** public types; likely non-breaking if `ServiceName` widens rather than narrows.

### [SEV-12] README documents a subscriptions shape the dispatcher does not use
- **ID:** `wss-adapter-full-12`
- **Severity:** Low
- **Category:** Docs
- **Confidence:** High
- **Location:** `/Users/revenge/code/wss-adapter/README.md:83-96` versus `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:431-445`
- **What:** The README's subscriptions example keys the map by human names (`'notifications'`, `'updates'`). The dispatcher does `callbacks[method]` where `method` is `response.method`, the **numeric** method code. Named keys never fire. Every real consumer keys by numeric code (`useSubWaitRoomHostEvents.ts:13` `const METHOD_CODE = 41017`), confirming the README is simply wrong. The README also never explains what `connect(['token1','token2'])` means (see finding 05), and `subscribeTo`'s documented event name resolution (`README:47`) works only through `getStreamEventKeys`'s cross-service name lookup, which finding 01 shows is service-blind.
- **Fix:** Correct the example to numeric method codes and add one sentence on the subprotocol auth convention. If the subscription API from finding 01 lands, rewrite this section around it and mark the raw map internal.
- **Effort:** S
- **Blast radius:** README.

### Robustness items that are clean (stated explicitly so nobody re-audits them)

- **No unbounded buffering while disconnected.** `sendHandler` rejects immediately when there is no session (`:348-352`) or when readyState is `CLOSING`/`CLOSED` (`:394-397`), and the `CONNECTING` path attaches one-shot listeners rather than queueing (`:374-393`). There is no message queue to grow, so no memory-leak or DoS surface there. The one leak is the timeout bookkeeping in finding 04.
- **No reconnect storm, because there is no reconnect.** The adapter never retries; `onclose` cleans up and calls `serviceConfig.onDisconnect`. Backoff and jitter therefore live in consumers (`nofilter.io/src/hooks/useAutoReconnect.ts`). That is a missing feature, not a bug, and it belongs in the same design conversation as finding 01.
- **Previous-socket teardown on reconnect is handled correctly** (`:217-229`): handlers are nulled before `close()` so a stale `onclose` cannot tear down the rotated connection. That is a real fix, not scaffolding.
- **`errors.ts` is the best-written file in the three repos.** `buildServiceError` has a clear message-selection order, never stringifies objects into `[object Object]`, preserves the envelope for structured branching, and restores the prototype for `instanceof` after transpile (`errors.ts:46`). Its tests match.

<details>
<summary>Nits (wss-adapter)</summary>

- `src/wss-adapter.ts:319-336`: `sendHandler` rebuilds `Object.entries(serviceConfig.methods).map(...).find(...)` on every single call to find the code for a method name, costing two allocations and an O(methods) scan per RPC. Build a `name -> code` map once in `configure`. The `if (!methodInfo)` check immediately after (`:332-336`) is unreachable: `methodCode` came from `Object.entries` of that same object.
- `src/wss-adapter.ts:12-20`: the singleton is declared with placeholder `configure() {}` / `subscribeTo() { return () => {}; }` implementations that are immediately overwritten at `:159` and `:194`, plus `__store: undefined as unknown as IStore` overwritten at `:515`. A factory function returning a configured instance would remove the placeholders, the module-level mutable `store`/`streamSubscribers`, and would make the package testable (there is currently no way to get a second instance, which is part of why there are no tests for `wss-adapter.ts`).
- `src/wss-adapter.ts:129-134`: `getSeq` increments before returning, so the first sequence number is 2, not 1. Harmless, but it means `sequence.value` is "next seq minus one", which nothing says.
- `src/wss-adapter.ts:409-412`: the error predicate `response.code || response.params?.success === false || response.params?.error` treats any truthy `params.error` field as an error, which will misfire on a legitimate payload that carries an `error` key.
- `example-error-format.js` at the repo root is a 1-byte file (a single newline). Dead; it does not ship (`files: ["dist"]`) but it should not be in git either.
- `.npmignore` is empty (0 bytes). Harmless since `files` wins, but it is one more file implying a policy that does not exist.
- Publish hygiene is otherwise correct: `files: ["dist"]`, `type: "module"`, an `exports` map with `types` and `import` (note `types` should come **first** in the condition order for older resolvers; here `import` precedes it, which some bundlers resolve differently), `main`/`types` fallbacks present, tests excluded from the build via `tsconfig.json:"exclude"`. No `sideEffects: false`, which is worth adding since the package is a singleton with module-level state that a bundler must not drop. `prepare: husky` runs on local installs only, not for tarball consumers.
- `tsconfig.json` is notably strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), which is good, and `wss-adapter.ts:106` `(response: any)` plus `types.ts:10` `(data: any)` are the places it is being opted out of.
</details>

---

## Cross-cutting recommendations

1. **Fix the two "silently wrong output" bugs before anything else.** iconify-preload's unescaped selectors (`iconify-preload-full-01`) and the purger's keyframe/font sweeps (`ui-css-purge-full-01/02/03`) share a shape: the build succeeds, the artifact is wrong, and nobody finds out until a human looks at a screen. Both are cheap to fix and both need a regression test that asserts on emitted CSS text, which neither repo currently has.
2. **Give each build tool an escape hatch and a dry run.** `--safelist` + `--dry-run` + a report naming removed selectors for the purger; `include: string[]` + a fail-on-truncate for iconify-preload. Static analysis of a dynamic language is always incomplete; the difference between a usable tool and an unusable one is whether the user can override it. This is the single change that would let the purger actually be wired into `nofilter.io`'s build.
3. **Land the wss-adapter subscription primitive, then close `__store`.** Order matters: ship `subscribeStream` plus a connection-state accessor, migrate the six nofilter.io hooks (deleting roughly 600 of their 906 lines and unifying three payload extractors), and only then remove `__store` from `IWssAdapter` in a major version. Doing it in the other order breaks a live app.
4. **Decide what the purge manifest is for.** Right now `generate-manifest.ts` spends ~300 lines reconstructing selector strings, CSS variables and keyframe ownership that the purger never reads, while the purger reimplements keyframe and variable analysis badly from raw CSS. Wiring the existing facts into `removeUnusedKeyframes`/`cleanUnusedVars` would fix findings 01-03 and delete the duplicated logic; deleting them would halve the manifest and the maintenance surface. Either is fine. The status quo is the worst of both.
5. **Make the three repos' tooling actually run.** wss-adapter lints with the wrong package and tests with `echo`; iconify-preload has no tests at all; only the purger has a working `bun test`. All three declare the same AGENTS.md verification discipline. One afternoon fixes the dependency, the schema, and the scripts, and the first honest lint/test run is the cheapest bug-finding this codebase will ever get.
6. **Treat build-time subprocess and registry access as a policy, not an accident.** iconify-preload shells out to `npx`/`bunx` (unpinned registry resolution inside a build) and the purger `import()`s library source. Neither is catastrophic, but both are undocumented build-time execution surfaces in packages that dozens of repos install. Replacing the iconify shell-out with the postcss API removes the only one that reaches the network.

## What I did not cover

- **No builds, no runtime execution.** I did not run `bun run build`, the purger CLI, or any consumer build, because that would have required `bun install` in trees that are not mine to mutate. Every finding is from static reading plus targeted read-only probes (the lightningcss selector parse, the Tailwind theme grep, the class-token scan of `UI/src/components`). Findings marked Medium confidence are the ones a run would settle.
- **I did not verify the published npm tarballs** against the repo contents, except indirectly through the copies installed in `UI/node_modules` and `js.software/node_modules` (which confirmed both the unescaped icon CSS and the purger's bundled `dist`). Note that `UI` has purge `0.9.11` installed while this repo is at `0.9.12`.
- **`@pathscale/ui` itself is out of scope.** The 16 zero-CSS components and the Tailwind-`node_modules`-scanning problem are sibling-review findings; I assessed only how this purger interacts with them.
- **The purger's SWC scanner was read, not fuzzed.** I did not construct adversarial JSX (HOCs, `createComponent` calls, render props returning UI components) to find more scanner blind spots. The `import-without-direct-jsx` fallback (`scan-consumer.ts:544-555`) makes most of those conservative, but I did not prove it exhaustively.
- **wss-adapter's protocol semantics** (what method code 20000 means, what the server does with `unsub: true`, whether `seq` must be per-connection) come from reading consumers, not from a protocol spec. If a spec exists, findings 03 and 09 should be re-checked against it.
- **`.claude/` hooks and settings** in all three repos were listed but not audited.

## Quick-start for the follow-up agent

**Read in this order:**

- `/Users/revenge/code/iconify-preload/src/index.ts:140-160`: the string interpolation that produces every icon rule; the Critical fix is here.
- `/Users/revenge/code/UI/src/styles/icons/generated-icons.css:1`: the committed output; confirms the selectors ship unescaped.
- `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:224-255`: `selectorDecision`, the entire purge policy in 30 lines; understand this before judging anything else in that repo.
- `/Users/revenge/code/rsbuild-plugin-ui-css-purge/src/postbuild-purge.ts:304-348`: the keyframe and font sweeps, where the High findings live.
- `/Users/revenge/code/wss-adapter/src/wss-adapter.ts:22-119` and `:428-455`: the two parallel stream-dispatch paths (`subscribeTo` vs `store.subscriptions`); the missing-API argument is visible in the diff between them.
- `/Users/revenge/code/nofilter.io/src/hooks/studio/useSubWaitRoomHostEvents.ts`: the canonical consumer hook; the API sketch in `wss-adapter-full-01` is derived from this file plus its five siblings.

**Commands to reproduce the evidence (all read-only):**

```bash
# Prove the icon selectors are inert (needs any repo with lightningcss installed)
cd /Users/revenge/code/UI && node -e '
const {transform}=require("lightningcss");
const t=c=>transform({filename:"x.css",code:Buffer.from(c),minify:false,
  visitor:{Selector(s){console.log(JSON.stringify(s));return s}}});
t(".icon-[mdi--close]{color:red}"); t(".icon-\\\\[mdi--close\\\\]{color:red}");'

# Tailwind v4 emits the animation name behind a variable
grep -n -- "--animate-spin\|@keyframes spin" /Users/revenge/code/UI/node_modules/tailwindcss/theme.css

# Consumers that would lose those keyframes
rg -o "animate-[a-z]+" /Users/revenge/code/nofilter.io/src | sort | uniq -c | sort -rn

# The purger's only test suite (it passes; it does not cover the bugs above)
cd /Users/revenge/code/rsbuild-plugin-ui-css-purge && bun test

# wss-adapter's disabled tests
cd /Users/revenge/code/wss-adapter && bun test src/errors.test.ts   # `bun run test` is an echo stub
```

**Surprising things about the layout:**

- All three repos carry an identical AGENTS.md/CLAUDE.md/`docs/frontend-conventions.md` trio and identical `.claude/` guardrails. The rules are real; the verification they assume (lint, test) is only actually wired up in the purger.
- iconify-preload's `docs/` contained only `frontend-conventions.md` before this review; `docs/reviews/` is new.
- The purger has two CLI entry points that are not both exposed: `postbuild-purge.ts` (via `bin`) and `scan-consumer.ts` (`import.meta.main` only, reachable by path).
- wss-adapter's `bunfig.toml` sets `bun = true` under `[run]`, so `node` resolves to bun inside that repo; do not assume a real Node when reproducing anything there.
- `@pathscale/ui` installs both `@iconify/tailwind4` and `@pathscale/rsbuild-plugin-iconify`, two icon pipelines producing the same intended CSS. Only one of them currently produces CSS that works.
