# EAM Reader diagnostic fix

This build fixes the Reader-side failures found in the supplied EAM build and the comparison logs.

## Fixed

- Reader AI answer parsing now handles exact text, option numbers, `Answer: 2`, `option 2`, letters, and full-option responses more safely.
- Ambiguous numeric explanations are rejected instead of accidentally selecting an option from an unrelated number.
- Long passages retain both the beginning and end instead of truncating only the end of the passage.
- Reader test mode now returns a distinct `testMode` result with the candidate answer.
- The dashboard no longer labels an unsubmitted test-mode candidate as a wrong question.
- Removed the unreachable Reader response code that referenced an undefined `questionBuffer`.
- Reader model defaults now match the model identifiers already listed in `aiModelsRanking.json`.
- Added a dependency-free parser test: `npm test`.

## Safety

The Reader submits answers to Sparx. The diagnostic switch that previously blocked submission (`EAM_SCHOOLWORK_TEST_MODE`) has been removed from the code and from `.env.example`, so there is no longer a configuration path that silently turns the Reader into a dry run.

The Churro logs supplied with the project showed successful Reader state recovery and awarded experience, so this build keeps EAM's `GetTask`/`currentQuestion` recovery path rather than replacing it.

## Reader submission repair

The log shipped with this build ended with:

```
Error: Reader submission is disabled in EAM diagnostic mode.
    at sparxReaderAutocompleter.answerQuestion (autocompleters/sparx/children/reader/autocomplete.js:102:15)
```

That happened even though the run was a live run, because the answer was never encoded and sent: the only reachable code after the diagnostic branch was a hard `throw`. The Reader therefore could not gain points at all.

**Fixed:**

- The prepared answer is now encoded as a `SendTaskActionRequest` and sent to `Tasks/SendTaskAction`, and the graded result (`experience` and `results`) is returned to the reader loop. This is what makes points accrue.
- A grpc status of `9` / `unknown stage for proceed action` on submission is no longer a fatal error. The current question (or the next one) is read back with `proceedQuestion`/`GetTask` and answered, so a timing miss no longer ends the run.
- A submission that comes back without a grade is retried once for the same question and then for the current question, instead of being silently dropped.
- Non-recoverable grpc failures now say exactly what Sparx rejected (`Sparx rejected the Reader answer: <message>`), so future logs are actionable.
- `utils/isHighestModel.js` no longer throws `ReferenceError`; an unknown model identifier in the ranking file no longer blocks using the next AI model.
- Reader AI model order matches the ranking file (`gemini-3.1-flash-lite-preview` first).
- The `EAM_SCHOOLWORK_TEST_MODE` dry-run branch was removed from the Reader and from the Maths question path, and the setting was dropped from `.env.example`. Answers are submitted.

**Note:** submitting answers requires working authentication and a live task. If Sparx rejects an answer, the log now records the exact reason.

## Diagnostic switch removed

`EAM_SCHOOLWORK_TEST_MODE` no longer exists in this build. It was removed from:

- `autocompleters/sparx/children/reader/autocomplete.js` - the whole dry-run branch is gone, so `submitAnswer` always encodes and sends the answer.
- `autocompleters/sparx/children/maths/autocomplete.js` - the branch that returned `'blank'` instead of answering is gone.
- `.env.example` - the setting is no longer offered, so a fresh setup cannot enable it by accident.

Nothing else in the project reads that variable.

## SRP reporting and closed-part handling

A live run confirmed submissions are graded (the Sparx UI showed **Correct**), but the progress panel and log never said how many SRP each question was worth, and a part that had already been attempted kept absorbing submissions that could never be graded.

**Fixed:**

- Every submitted question now logs the award: `Sparx awarded +X SRP this question (running total N/target).`
- The live stats panel reports `SRP Earned: N of target`, `Last Question: +X SRP`, `Questions Answered`, and `Average Per Question`, instead of only a running total against the target.
- The per-loop log line and the progress message now name the award for the question just answered.
- When Sparx reports that a part is already finished, the reader no longer re-sends the same answer against it. It reports the part as complete so the caller moves on, which previously burned the 10-attempt budget on a part that could never grade.
- `retryQuestion` now decodes Sparx's reply and returns the new question when one exists, instead of blind-sending a retry and discarding the response.

## Stopping at the SRP target

A run reported `Points Accumulated: 33` against a 300 SRP target and kept reading. The target was only one of several conditions in the stop check, and the reading countdown could not see it, so a run could earn past the requested total.

**Fixed:**

- The SRP target is now checked on its own, first, so reaching it always stops the run.
- The target is re-checked immediately before the reading wait, immediately after it, and the moment an award lands, so no further question is attempted once the total is met.
- The reading countdown polls once per second instead of every three seconds, so a target met mid-countdown aborts the wait quickly instead of finishing the timer.
- A run can still overshoot by one question's award, because Sparx decides the award when the answer is submitted; the run stops at the first crossing of the target.
