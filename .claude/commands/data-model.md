---
description: "Derive the data model from source — entities, columns, cardinality — with every element banded by confidence and exportable as Mermaid"
argument-hint: "[--confidence certain|all] [--scope <path>] [--out <dir>]"
---

Reconstruct the data model by reading the code, and **never present a guess as a fact**.

```bash
rmad index erd --root .                       # declared relationships only (default)
rmad index erd --root . --confidence all      # include inferred and heuristic, labelled
rmad index erd --root . --out .planning/artifacts
rmad index erd --root ../their-app --json     # any repo; no index required
```

This reads source directly, so it works on a repository that has never been indexed.

## What it reads

| Source | Confidence | Yields |
|---|---|---|
| Prisma schema | `certain` | Everything, including cardinality and optionality |
| Django models | `certain` | Fields, `ForeignKey`/`OneToOne`/`ManyToMany`, `on_delete`, nullability |
| SQLAlchemy | `certain` | `Column`, `ForeignKey`, `relationship`, `__tablename__` |
| TypeORM | `certain` | `@Entity`, `@Column`, `@ManyToOne` and friends |
| Rails `schema.rb` | `certain` | A snapshot, so preferred over replaying migrations |
| Raw DDL | `certain` | `CREATE TABLE`, inline and table-level `REFERENCES` |
| Naming convention | **`heuristic`** | `user_id` beside a `users` entity — a hypothesis |

## The rule this command exists to enforce

> **A relationship inferred from a column name is not a foreign key, and must never be
> drawn like one.**

An ERD gets screenshotted into a design document and outlives its caveats. So:

- The default export is `certain` **only**, and it tells you how many relationships it hid.
- `--confidence all` includes the rest, each **labelled in the diagram itself**, not just in
  a footnote.
- Every entity, column and relationship carries the `file:line` that produced it, in an
  **evidence table emitted beside the diagram** — Mermaid has nowhere to put provenance, so
  it lives next to it. Ship the diagram alone and the caveats are lost.

## Reading the output

The artefact is a **pair**, and both halves matter:

1. **The diagram** — for orientation. Cardinality tokens carry optionality: `||` exactly
   one, `|o` zero or one, `}o` zero or more, `}|` one or more.
2. **The evidence table** — one row per element, with confidence and source. `**no declared
   FK**` marks a relationship the schema never actually declared.
3. **"What this cannot see"** — the limits section. Read it before trusting completeness.

## What it genuinely cannot see

- Schemaless stores, and JSON/JSONB columns whose structure lives only in application code
- Tables created dynamically at runtime
- Relationships enforced solely by application logic — these surface as `heuristic` or not at all
- EF Core fluent configuration, which generally requires *evaluating* C# rather than parsing it

If the repo uses any of these, the model is **incomplete by construction** and the report
must say so. A diagram of the tables a static reader can see is not the same thing as a
diagram of the data model, and only one of those is what a reader assumes they are looking at.

## When it finds nothing

That is a real answer, not a failure. Either there is no relational model, or it is
expressed in a way static reading cannot reach. Say which you think it is, and why —
do not report an empty diagram as "no data model".

$ARGUMENTS
