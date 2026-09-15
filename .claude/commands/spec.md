---
description: Investigate a topic and write the spec that CLAUDE.md section 5 requires before code
argument-hint: <topic>
---

Write the spec for: **$ARGUMENTS**

This is the Investigate and Spec half of CLAUDE.md section 5. **Write no code in this command.**
Ending this command with a code change is a failure, even a small one.

## 1. Investigate — read only

- Read `docs/concepts/` and `docs/log/` for this area **first**. If a decision here was already
  settled, cite the log and do not relitigate it.
- Read the actual code paths involved. Use the codebase-memory graph to find candidates, then
  confirm with `grep` — the graph under-reports callers
  (`docs/concepts/codebase-memory-graph-accuracy.md`).
- Every negative claim in the spec ("nothing calls this", "safe to delete", "unused") must be
  backed by pasted grep output. No exceptions.

## 2. Write `docs/planning/<topic>.md`

Indonesian, with the frontmatter `docs/KONVENSI.md` requires (`type: plan`, `status: planning`,
`updated:`, `tags:`). One page. These headings, in this order:

1. **Masalah** — what is actually wrong, in operator or data terms, not in code terms.
2. **Ruang lingkup** — what this change covers.
3. **Di luar lingkup** — explicitly. This section is not optional and "none" is almost never
   the true answer.
4. **Blast radius** — files, endpoints, tables, and which of the seven domains in CLAUDE.md
   section 1 can feel it. Name anything on the STOP list that this touches.
5. **Rencana** — numbered steps, files per step, commit order.
6. **Verifikasi** — how we will know it worked, in terms someone else could re-run. Which test,
   which screen at which viewport, which query with which expected number.
7. **Pertanyaan terbuka** — what needs a human answer before step 1.

## 3. Register and stop

- Add a line to `docs/PLANNING.md`.
- Link the spec to the concept notes it rests on, per `docs/KONVENSI.md` section 2.
- Report the blast radius and the open questions, then **stop and wait**. If the plan touches
  the STOP list, say so explicitly and do not begin.
