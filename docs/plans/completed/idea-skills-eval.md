# Idea skills eval

Status: Superseded by consolidation into the create-page skill. The sixteen-idea eval is retired; no further model runs are planned for it.

## Original scope

Measure whether the worker selects one of sixteen document-format skills without an explicit skill request, distinguish sibling confusion from generic false positives, and measure the catalog cost. The prototype covered 240 trials per model, with positive, sibling, and generic cases.

## Findings retained

The measured sixteen-idea registry required 12,754 catalog characters against an 8,000-character budget. All sixteen idea descriptions were shortened, often removing their routing clauses. Partial model results were insufficient for a reliable comparison, and some non-loads were appropriate requests for missing inputs or direct chat answers.

The catalog's raw truncation could end in a partial word. The retained fix trims at a word boundary within the escaped-text budget, preserving Unicode characters and falling back to a character boundary when a single word cannot fit. Focused local tests cover the behavior.

## Retirement

A single create-page skill supersedes the sibling-selection matrix and its proposed per-idea descriptions. The dedicated cases, fixtures, runner, report helpers, and registration were removed. Historical results and a source snapshot remain in the ignored local eval-results directory.

The 16,000-character budget proposal was specific to the measured registry; it is not a recommendation to change the budget for the consolidated skill. Any future evaluation should target create-page's actual behavior and use GLM 5.3 Flash as the preferred model. Paid model evals require explicit authorization. GitHub issues require an explicit request.
