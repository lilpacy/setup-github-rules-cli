import test from "node:test";
import assert from "node:assert/strict";

import { makeRepositorySettingsPayload, parseArgs, resolveApprovals, selectApprovals } from "../bin/setup-github-rules.js";

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

test("準正常系: default branch を変更しないとき マージ後のブランチ削除だけを有効にする", () => {
  const payload = makeRepositorySettingsPayload({
    currentDefaultBranch: "main",
    selectedBranch: "main"
  });

  assert.deepEqual(payload, {
    delete_branch_on_merge: true
  });
});

test("正常系: default branch を変更するとき マージ後のブランチ削除も一緒に有効にする", () => {
  const payload = makeRepositorySettingsPayload({
    currentDefaultBranch: "main",
    selectedBranch: "develop"
  });

  assert.deepEqual(payload, {
    default_branch: "develop",
    delete_branch_on_merge: true
  });
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
    isInteractive: true
  });

  assert.equal(approvals, 2);
});

test("resolveApprovals still prompts in an interactive terminal", async () => {
  const prompts = [];
  const { result: approvals } = await captureLogs(async () => resolveApprovals({
    question: async (prompt) => {
      prompts.push(prompt);
      return "0";
    }
  }, {
    preselectedApprovals: null,
    isInteractive: true
  }));

  assert.equal(approvals, 0);
  assert.deepEqual(prompts, ["Required approvals [0-6] (default: 0): "]);
});

test("resolveApprovals defaults to 0 outside an interactive terminal", async () => {
  const approvals = await resolveApprovals({
    question: async () => {
      throw new Error("question should not be called");
    }
  }, {
    preselectedApprovals: null,
    isInteractive: false
  });

  assert.equal(approvals, 0);
});

test("selectApprovals accepts enter for the default value", async () => {
  const prompts = [];
  const { result: approvals } = await captureLogs(async () => selectApprovals({
    question: async (prompt) => {
      prompts.push(prompt);
      return "";
    }
  }, null));

  assert.equal(approvals, 0);
  assert.deepEqual(prompts, ["Required approvals [0-6] (default: 0): "]);
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
    "Required approvals [0-6] (default: 0): ",
    "Required approvals [0-6] (default: 0): ",
    "Required approvals [0-6] (default: 0): "
  ]);
  assert.deepEqual(logs, [
    "\nChoose the number of required approving reviews.",
    "Use 0 for solo repositories where nobody else can approve your PR.",
    "Please enter an integer between 0 and 6.",
    "Please enter an integer between 0 and 6."
  ]);
});
