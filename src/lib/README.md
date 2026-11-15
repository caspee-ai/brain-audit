# The audit code

Everything here is pure TypeScript: no network, no clock and no file system (the CLI in
`cli/brain-audit/src/` does the reading, the method download and the one upload). The same
code runs on the Caspee platform when a brain is brought to it, so the CLI's scores are the
platform's for the same files and the same method.

Every step takes the audit's **method** as input: the catalogue of business elements, the
mapping words, the rubric, the weights, the page shapes and the conventions the classifier
follows. The method is not in this code; the CLI downloads it from the audit server for each
audit. `brain-audit-core/method/` holds its type, its strict parser (`parse.ts`), its content
hash (`hash.ts`) and the engine's rules over it (`rules.ts`, `words.ts`). This repository's
tests run on a synthetic method (`test/fixtures/method.json`). General rules for reading any folder of notes stay in the code: file formats, link and date syntax, the files of note-taking tools (Obsidian, Logseq, Notion exports), and common header words for access, people and sources.

A run goes through it in this order:

1. **Read** (`brain-audit-core/byob/`): `manifest.ts` decides which files are read and which
   are only counted; `decode.ts` and `records/` decode text and data files; `dialect.ts` and
   `tool.ts` tell what made the brain (Obsidian, Logseq, Notion, a docs site, plain Markdown);
   `scope.ts` and `mirrors.ts` drop scaffolding and duplicate copies; `pages.ts` and
   `roles.ts` give every file exactly one role (page, data, template, attachment, …), decided
   by its strongest signal first. `classify.ts` runs
   these steps in order.
2. **Profile** (`brain-audit-core/profile/`): the brain's conventions (where dates, owners and
   tags live), inferred from the files and laid under a `byob.yml` if the folder has one.
3. **Structural audit** (`brain-audit-core/audit/`): per-file facts (`extract.ts`), the link
   graph (`graph.ts`), structure against peers (`structure.ts`), tags and dates, and one score
   from 0 to 100 (`score.ts`). `summary.ts` names the findings.
4. **Merit** (`brain-audit-core/merit/`): which elements of the method's catalogue of
   business elements apply to a company type (`company-type.ts`), the checklist
   items of each (`checklist.ts`), the files that might cover each one (`mapping.ts`), the
   metadata-only pack the agent grades (`pack.ts`), the rubric it grades with (`rubric.ts`),
   the check of its grades (`grades.ts`) and the merit score (`score.ts`).
5. **Report** (`brain-audit-core/pack/`): the plain summary and its closed vocabulary
   (`summary.ts`, `vocab.ts`), the sealed report (`sealed-pack.ts`), its AES-256-GCM sealing
   (`crypto.ts`) and the report link (`link.ts`; the CLI builds the link with it on the
   `--api` origin, never from the server's answer). `constellation/` lays out the report's map of
   the brain (areas found with Louvain community detection).

`brain-audit-core/vocabulary/` holds the fixed word lists the steps share, and
`brain-audit-core/markdown.ts` how a page is read line by line (front matter, body, code).

`shared/` holds the small modules the core shares with the rest of the platform: front
matter, canonical JSON, HTML text, limits, type coercion and UUIDs.
`shared/platform-types.ts` stands in for the types of platform records the core can take as
input but the CLI never builds: the fields the core reads, with real types, so
`npm run check` type-checks all of this code.
