# Whether CI stays near four minutes a run

**Status:** open · **Check after:** 2026-11-24 · **Last checked:** 2026-11-10

## What we're waiting to learn

381e8c05d (#187) split the unit suites into four Linux and four Windows shards, each on its own runner. Its branch runs measured a PR going from about 14.5 minutes to 5.5. Suites only grow, and a job that falls out of balance or a cache that stops hitting takes the time back without anyone choosing to. The question is whether a run stays near today's time, and which job sets it when it doesn't.

## The signal

For the CI workflow's completed first attempts (`run_attempt` 1, success or failure, no cancels), the run's time from `run_started_at` to `updated_at`, by event (push, pull request): median, p75 and p90. For the last 25 runs, each job's median and maximum, from the run's jobs `started_at` to `completed_at`. The slowest job's median is what the run's median follows.

The baseline on 2026-11-10, from 64 runs since 11-07:

| Runs | Median | p75 | p90 |
| --- | --- | --- | --- |
| Push to main | 4.4 min | 4.7 min | 5.8 min |
| Pull request | 4.1 min | 4.5 min | 4.7 min |
| Before #187 (10-20 to 11-02), push | 14.8 min | 17.9 min | 23.1 min |
| Before #187 (10-20 to 11-02), pull request | 14.2 min | 15.4 min | 15.9 min |

Job medians over the last 25 runs: Browser Tests 4.0 min (max 5.3), the eight test shards 2.6 to 3.3 min (max 4.8), Check 1.7 min. Browser Tests sets the run's time. Every run over 8 minutes since #187 was Browser Tests taking 12 to 18 minutes, all on 11-05 and 11-06, none since.

## Where to look

The GitHub Actions API for this repo's CI workflow: `actions/workflows/ci.yml/runs` filtered by `created`, and each run's `jobs`. Each test shard's log also prints what every suite took and whether it came from Turbo's cache, in the step after the tests.

## What each answer means

- **Medians within a minute of the baseline:** close it.
- **The run's median above 6 minutes with one test shard well above the others:** the shards are out of balance. Read that shard's suite times and move to more shards for that platform, or split the slow file.
- **Every shard slower about evenly:** the suites grew, or the cache stopped hitting. Compare the shards' cache lines with a run from the baseline week before changing the layout.
- **Browser Tests above 6 minutes, or 12-minute runs back:** Browser Tests is the job to split or speed up next; read one slow run's log to see where its time went first.

## Result
