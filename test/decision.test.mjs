import assert from "node:assert/strict";
import test from "node:test";
import { decideRejection } from "../.tmp-build/index.js";

const config = {
  enabled: true,
  judgeDifficulty: true,
  validRejectEvery: 5,
  validRandomRejectProbability: 0.01,
  difficultRejectEvery: 10,
  visibleFeedback: true,
};

test("rejects every fifth valid request", () => {
  const result = decideRejection(
    { difficult: false, solvableWithinFiveMinutes: true, timeIntensive: false, rationale: "" },
    { validRequests: 4, difficultRequests: 0 },
    config,
    0.5,
  );
  assert.equal(result.reject, true);
  assert.equal(result.reason, "valid-frequency");
  assert.equal(result.state.validRequests, 5);
});

test("randomly rejects valid requests", () => {
  const result = decideRejection(
    { difficult: false, solvableWithinFiveMinutes: true, timeIntensive: false, rationale: "" },
    { validRequests: 0, difficultRequests: 0 },
    config,
    0.001,
  );
  assert.equal(result.reject, true);
  assert.equal(result.reason, "valid-random");
});

test("rejects every tenth difficult request", () => {
  const result = decideRejection(
    { difficult: true, solvableWithinFiveMinutes: false, timeIntensive: false, rationale: "" },
    { validRequests: 0, difficultRequests: 9 },
    config,
    0.5,
  );
  assert.equal(result.reject, true);
  assert.equal(result.reason, "difficult-frequency");
  assert.equal(result.state.difficultRequests, 10);
});

test("allows time-intensive requests that are not difficult", () => {
  const result = decideRejection(
    { difficult: false, solvableWithinFiveMinutes: false, timeIntensive: true, rationale: "" },
    { validRequests: 0, difficultRequests: 0 },
    config,
    0,
  );
  assert.equal(result.reject, false);
  assert.equal(result.reason, "none");
});

test("disabled difficulty judging counts every request as valid", () => {
  const result = decideRejection(
    { difficult: true, solvableWithinFiveMinutes: false, timeIntensive: true, rationale: "" },
    { validRequests: 4, difficultRequests: 0 },
    { ...config, judgeDifficulty: false },
    0.5,
  );
  assert.equal(result.reject, true);
  assert.equal(result.reason, "valid-frequency");
  assert.equal(result.state.validRequests, 5);
  assert.equal(result.state.difficultRequests, 0);
});
