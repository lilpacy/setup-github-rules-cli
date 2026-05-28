import test from "node:test";
import assert from "node:assert/strict";

import { makeRepositorySettingsPayload, parseArgs, resolveApprovals, runSetup, selectApprovals } from "../bin/setup-github-rules.js";

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

function createSetupDeps(overrides = {}) {
  const logs = [];
  const apiCalls = [];

  return {
    logs,
    apiCalls,
    detectRepoFromGitRemote: () => "owner/repo",
    ghApi: (endpoint, options = {}) => {
      apiCalls.push({ endpoint, options });
      return null;
    },
    branchExists: () => {
      throw new Error("branchExists should not be called");
    },
    createBranchFrom: () => {
      throw new Error("createBranchFrom should not be called");
    },
    findExistingRuleset: () => {
      throw new Error("findExistingRuleset should not be called");
    },
    log: (message = "") => {
      logs.push(message);
    },
    question: async () => {
      throw new Error("question should not be called");
    },
    inputIsTTY: true,
    outputIsTTY: true,
    ...overrides
  };
}

test("parseArgs keeps explicit required approvals", () => {
  const args = parseArgs(["--required-approvals", "2"]);

  assert.equal(args.approvals, 2);
});

test("準正常系: 単体適用で関連しないオプションを指定したとき エラーになる", () => {
  assert.throws(
    () => parseArgs(["--only", "delete-branch-on-merge", "--branch", "develop"]),
    /--branch cannot be used with --only delete-branch-on-merge\./
  );
});

test("正常系: 単体適用を指定したとき 対象設定だけを選べる", () => {
  const args = parseArgs(["--only", "delete-branch-on-merge", "--repo", "owner/repo", "--yes"]);

  assert.equal(args.only, "delete-branch-on-merge");
  assert.equal(args.repo, "owner/repo");
  assert.equal(args.yes, true);
});

test("異常系: 未対応の単体適用を指定したとき エラーになる", () => {
  assert.throws(
    () => parseArgs(["--only", "unknown"]),
    /--only must be one of: delete-branch-on-merge\./
  );
});

test("異常系: 単体適用の値がないとき エラーになる", () => {
  assert.throws(
    () => parseArgs(["--only"]),
    /--only must be one of: delete-branch-on-merge\./
  );
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

test("正常系: 単体適用かつ確認を省略したとき マージ後のブランチ削除だけを適用する", async () => {
  const deps = createSetupDeps();
  const args = parseArgs(["--repo", "owner/repo", "--only", "delete-branch-on-merge", "--yes"]);

  await runSetup(args, deps);

  assert.deepEqual(deps.apiCalls, [
    {
      endpoint: "/repos/owner/repo",
      options: {
        method: "PATCH",
        body: { delete_branch_on_merge: true }
      }
    }
  ]);
});

test("正常系: 単体適用で確認したとき 承認後にマージ後のブランチ削除だけを適用する", async () => {
  const prompts = [];
  const deps = createSetupDeps({
    question: async (prompt) => {
      prompts.push(prompt);
      return "yes";
    }
  });
  const args = parseArgs(["--repo", "owner/repo", "--only", "delete-branch-on-merge"]);

  await runSetup(args, deps);

  assert.deepEqual(prompts, ["\nApply these changes? [y/N]: "]);
  assert.deepEqual(deps.apiCalls, [
    {
      endpoint: "/repos/owner/repo",
      options: {
        method: "PATCH",
        body: { delete_branch_on_merge: true }
      }
    }
  ]);
});

test("準正常系: 単体適用の dry-run のとき 変更せずに終了する", async () => {
  const deps = createSetupDeps();
  const args = parseArgs(["--repo", "owner/repo", "--only", "delete-branch-on-merge", "--dry-run"]);

  await runSetup(args, deps);

  assert.deepEqual(deps.apiCalls, []);
  assert.ok(deps.logs.includes("\nDry run only. No changes were made."));
});

test("正常系: 通常実行のとき default branch と ruleset をまとめて設定する", async () => {
  const apiCalls = [];
  const deps = createSetupDeps({
    apiCalls,
    ghApi: (endpoint, options = {}) => {
      apiCalls.push({ endpoint, options });
      if (endpoint === "/repos/owner/repo" && options.method === undefined) {
        return { default_branch: "main" };
      }
      return null;
    },
    branchExists: () => true,
    findExistingRuleset: () => null
  });
  const args = parseArgs([
    "--repo",
    "owner/repo",
    "--branch",
    "develop",
    "--required-approvals",
    "1",
    "--yes"
  ]);

  await runSetup(args, deps);

  assert.deepEqual(apiCalls.map((call) => [call.endpoint, call.options.method ?? "GET"]), [
    ["/repos/owner/repo", "GET"],
    ["/repos/owner/repo", "PATCH"],
    ["/repos/owner/repo/rulesets", "POST"]
  ]);
  assert.deepEqual(apiCalls[1].options.body, {
    default_branch: "develop",
    delete_branch_on_merge: true
  });
  assert.equal(apiCalls[2].options.body.rules[0].parameters.required_approving_review_count, 1);
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
