# Harness diagnosis: link-shortener (halted-stalled, 3 identical failures)

## Failure group 1: `GET /:slug redirects with 302 and counts the click`

**Verdict: TEST_WRONG**

**Evidence**
- The test creates a link with `slug: 'go'` (2 characters). The spec requires slugs of 3 to 32 characters.
- The test `POST /api/links rejects bad slugs with 400` in the same file requires `'ab'` (also 2 characters) to be rejected.
- No implementation can both accept `'go'` and reject `'ab'`. The implementation correctly returns 400 for the create, so `GET /go` returns 404 instead of 302.
- The other 36 tests pass (15 of 16 acceptance, 21 unit). Source coverage is 98.73%.
- The hidden holdout and mutation steps never ran, because they wait for the tests to pass. Their result is unknown.

**Cause:** an authoring mistake in the acceptance test, written by the orchestrating session, not by the generator. The generator correctly refused to weaken the validator.

**Next step for a human:** change `'go'` to a slug of 3 or more characters (for example `'goo'`) in the test, including the `/go` URLs, then restart the run with the same verify gate. Retrying the implementation will not help.

## Not diagnosed
Holdout and mutation spot-check are unchecked. The implementer noted these ambiguities that could matter there: `slug: null` and `expiresAt: null` are treated as invalid (not absent), and every POST counts toward the rate limit, including invalid ones.
