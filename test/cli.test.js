import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, resolveApprovals, selectApprovals } from "../bin/setup-github-rules.js";

async function captureLogs(run) {
  const logs = [];
  const originalLog = console.log;
  console.log = (message = "") => {
    logs.push(message);
  };

  try {
    const result = await run();
    return { logs, result };
  } finally {
    console.log = originalLog;
  }
}

test("parseArgs keeps explicit required approvals", () => {
  const args = parseArgs(["--required-approvals", "2"]);

  assert.equal(args.approvals, 2);
});

test("selectApprovals returns preselected value without prompting", async () => {
  const approvals = await selectApprovals({
    question: async () => {
      throw new Error("question should not be called");
    }
  }, 3);

  assert.equal(approvals, 3);
});

test("resolveApprovals keeps explicit approvals without prompting", async () => {
  const approvals = await resolveApprovals({
    question: async () => {
      throw new Error("question should not be called");
    }
  }, {
    preselectedApprovals: 2,
    assumeYes: false,
    isInteractive: true
  });

  assert.equal(approvals, 2);
});

test("resolveApprovals defaults to 1 for --yes without prompting", async () => {
  const approvals = await resolveApprovals({
    question: async () => {
      throw new Error("question should not be called");
    }
  }, {
    preselectedApprovals: null,
    assumeYes: true,
    isInteractive: true
  });

  assert.equal(approvals, 1);
});

test("resolveApprovals defaults to 1 outside an interactive terminal", async () => {
  const approvals = await resolveApprovals({
    question: async () => {
      throw new Error("question should not be called");
    }
  }, {
    preselectedApprovals: null,
    assumeYes: false,
    isInteractive: false
  });

  assert.equal(approvals, 1);
});

test("selectApprovals accepts enter for the default value", async () => {
  const prompts = [];
  const { result: approvals } = await captureLogs(async () => selectApprovals({
    question: async (prompt) => {
      prompts.push(prompt);
      return "";
    }
  }, null));

  assert.equal(approvals, 1);
  assert.deepEqual(prompts, ["Required approvals [0-6] (default: 1): "]);
});

test("selectApprovals retries until it receives a valid integer", async () => {
  const answers = ["abc", "7", "0"];
  const prompts = [];
  const { logs, result: approvals } = await captureLogs(async () => selectApprovals({
      question: async (prompt) => {
        prompts.push(prompt);
        return answers.shift();
      }
    }, null));

  assert.equal(approvals, 0);
  assert.deepEqual(prompts, [
    "Required approvals [0-6] (default: 1): ",
    "Required approvals [0-6] (default: 1): ",
    "Required approvals [0-6] (default: 1): "
  ]);
  assert.deepEqual(logs, [
    "\nChoose the number of required approving reviews.",
    "Use 0 for solo repositories where nobody else can approve your PR.",
    "Please enter an integer between 0 and 6.",
    "Please enter an integer between 0 and 6."
  ]);
});
