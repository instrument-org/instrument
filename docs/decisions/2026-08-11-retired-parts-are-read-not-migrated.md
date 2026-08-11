# A retired data part is read and filtered, not migrated

Date: 2026-08-11

## Decision

When a persisted data part's producer is deleted, the part's schema stays behind as a read-only member and the renderer filters what it draws. Nothing rewrites the stored payload.

Applied to `data-fileChanges`, the change card the task-directory watcher fed before the ` ```files ` fence replaced it ([file-references-without-a-watcher.md](../plans/completed/file-references-without-a-watcher.md)). The part is still parsed, narrowed to `filePath` and `status`, and drawn as the same grid a fence draws, restricted to `output/`.

## Why

Deleting the producer also deleted the schema, and a data part whose name has no schema is replaced on read by `{originalType, reason}`. The payload survives in `task.db` either way; what is lost is the ability to read it. For a conversation from before the fence, that part is the only record of what a turn produced, so the deletion quietly cost those transcripts every link between a reply and its files.

The obvious repair is a migration that writes a synthetic fence into old messages. Measured against a 596-task workspace before choosing, that turned out to be the wrong shape:

| | files | share |
| --- | ---: | ---: |
| `work/` (agent scratch) | 26,889 | 98.0% |
| `output/` (deliverables) | 295 | 1.1% |
| `skills/` | 113 | 0.4% |
| `attachments/` (the user's own uploads) | 108 | 0.4% |

27,443 files across 318 parts, median 9 per part and **5001** at the largest, which is the old index's file cap: one part had enumerated the entire task directory. A migration would have written that into people's history as something the assistant said, and attributed the user's own uploads to the assistant. The 98% is also the reason the card was deleted, so restoring it faithfully would have restored the defect.

Reading and filtering gets the same result without any of that:

- **The filter belongs at read time**, where it can be changed or removed later. A migration bakes one judgment into stored data permanently, and the judgment here (`output/` is the deliverable directory) is exactly the kind that gets revised.
- **Nothing is written, so nothing can be got wrong.** A migration over 182 tasks that misjudges one case has already damaged them.
- **It costs less.** A schema member, a renderer case, and a filter, against a migration plus its own correctness burden.

The narrowing matters as much as the filtering. The stored payload also carried `filename`, `mimeType`, `modifiedAt`, and `size`; the first two are derivable from the path and the last two were the freshness machinery the same work removed. Reading only the two fields still used means the schema states how much of the retired idea survives, rather than preserving a shape nobody honors.

## Alternatives

- **Migrate into a synthetic fence.** Rejected above.
- **Leave it unreadable.** The default, and what shipped for a short while. Defensible, since the files are all still reachable through the task's file panel; what is lost is only the link from the reply that made them. Rejected because that link is most of what a transcript is for.
- **Keep the raw payload on `data-unknown` and sniff `originalType` in the client.** Generalizes to every future retired part, but puts unvalidated data in the renderer and hides from a reader of the schema that anything still depends on the old shape. A named member is the honest record.

## Costs

The retired member is visible in `NameSchema` and will read to someone later as though it were live. Mitigated by grouping and a docblock that says nothing writes it, and by a removal note: it can go once tasks predating the fence are not worth reading. Deleting it means deleting the schema, the enum member, and the renderer case, and the exhaustiveness checks on `DATA_PART_DISPLAY` and the render switch name all three without being asked.

Carried out in `a2fd717c2`.
