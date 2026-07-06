import test from "node:test";
import assert from "node:assert/strict";

import { makeRepositorySettingsPayload, parseArgs, parseGitHubRemoteUrl, resolveApprovals, resolveSelection, runSetup, selectApprovals } from "../bin/setup-github-rules.js";

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

test("準正常系: ssh URL 形式の origin remote から repository を検出できる", () => {
  const repo = parseGitHubRemoteUrl("ssh://git@github.com/lilpacy/castkit-v2.git");

  assert.equal(repo, "lilpacy/castkit-v2");
});

test("正常系: scp 形式の origin remote から repository を検出できる", () => {
  const repo = parseGitHubRemoteUrl("git@github.com:lilpacy/castkit-v2.git");

  assert.equal(repo, "lilpacy/castkit-v2");
});

test("正常系: HTTPS 形式の origin remote から repository を検出できる", () => {
  const repo = parseGitHubRemoteUrl("https://github.com/lilpacy/castkit-v2.git");

  assert.equal(repo, "lilpacy/castkit-v2");
});

test("正常系: 設定フラグ無しのとき 全設定を適用対象に選ぶ", () => {
  const selection = resolveSelection(parseArgs(["--repo", "owner/repo"]));

  assert.deepEqual(selection, {
    branchProtection: true,
    deleteBranchOnMerge: true,
    mergeMethod: false
  });
});

test("正常系: --branch だけ指定したとき branch protection だけを選ぶ", () => {
  const selection = resolveSelection(parseArgs(["--repo", "owner/repo", "--branch", "develop"]));

  assert.deepEqual(selection, {
    branchProtection: true,
    deleteBranchOnMerge: false,
    mergeMethod: false
  });
});

test("正常系: --merge-method だけ指定したとき マージ方式だけを選ぶ", () => {
  const selection = resolveSelection(parseArgs(["--repo", "owner/repo", "--merge-method", "squash"]));

  assert.deepEqual(selection, {
    branchProtection: false,
    deleteBranchOnMerge: false,
    mergeMethod: true
  });
});

test("正常系: --delete-branch-on-merge だけ指定したとき ブランチ削除だけを選ぶ", () => {
  const selection = resolveSelection(parseArgs(["--repo", "owner/repo", "--delete-branch-on-merge"]));

  assert.deepEqual(selection, {
    branchProtection: false,
    deleteBranchOnMerge: true,
    mergeMethod: false
  });
});

test("異常系: 他の設定だけを選びつつ --required-approvals を指定したとき エラーになる", () => {
  assert.throws(
    () => parseArgs(["--repo", "owner/repo", "--merge-method", "squash", "--required-approvals", "1"]),
    /--required-approvals and --ruleset-name require --branch/
  );
});

test("異常系: 他の設定だけを選びつつ --ruleset-name を指定したとき エラーになる", () => {
  assert.throws(
    () => parseArgs(["--repo", "owner/repo", "--delete-branch-on-merge", "--ruleset-name", "x"]),
    /--required-approvals and --ruleset-name require --branch/
  );
});

test("正常系: 設定フラグ無しで --required-approvals を指定したとき フル設定として許容される", () => {
  const args = parseArgs(["--repo", "owner/repo", "--required-approvals", "1"]);

  assert.equal(args.approvals, 1);
  assert.equal(resolveSelection(args).branchProtection, true);
});

test("異常系: 未対応のマージ方式を指定したとき エラーになる", () => {
  assert.throws(
    () => parseArgs(["--merge-method", "unknown"]),
    /--merge-method must be one of: squash, merge, rebase\./
  );
});

test("準正常系: ブランチ削除だけを選んだとき delete_branch_on_merge だけを含む", () => {
  const payload = makeRepositorySettingsPayload({
    selection: { branchProtection: false, deleteBranchOnMerge: true, mergeMethod: false }
  });

  assert.deepEqual(payload, {
    delete_branch_on_merge: true
  });
});

test("正常系: branch protection で default branch を変更するとき default_branch を含む", () => {
  const payload = makeRepositorySettingsPayload({
    selection: { branchProtection: true, deleteBranchOnMerge: true, mergeMethod: false },
    currentDefaultBranch: "main",
    selectedBranch: "develop"
  });

  assert.deepEqual(payload, {
    delete_branch_on_merge: true,
    default_branch: "develop"
  });
});

test("正常系: マージ方式だけを選んだとき 許可設定だけを含む", () => {
  const payload = makeRepositorySettingsPayload({
    selection: { branchProtection: false, deleteBranchOnMerge: false, mergeMethod: true },
    mergeMethod: "squash"
  });

  assert.deepEqual(payload, {
    allow_merge_commit: false,
    allow_squash_merge: true,
    allow_rebase_merge: false
  });
});

test("正常系: --merge-method だけの単体適用のとき ruleset を作らず PATCH だけ実行する", async () => {
  const deps = createSetupDeps();
  const args = parseArgs(["--repo", "owner/repo", "--merge-method", "rebase", "--yes"]);

  await runSetup(args, deps);

  assert.deepEqual(deps.apiCalls, [
    {
      endpoint: "/repos/owner/repo",
      options: {
        method: "PATCH",
        body: {
          allow_merge_commit: false,
          allow_squash_merge: false,
          allow_rebase_merge: true
        }
      }
    }
  ]);
});

test("正常系: --delete-branch-on-merge だけの単体適用のとき PATCH だけ実行する", async () => {
  const deps = createSetupDeps();
  const args = parseArgs(["--repo", "owner/repo", "--delete-branch-on-merge", "--yes"]);

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

test("準正常系: 単体適用の dry-run のとき 変更せずに終了する", async () => {
  const deps = createSetupDeps();
  const args = parseArgs(["--repo", "owner/repo", "--merge-method", "squash", "--dry-run"]);

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
    default_branch: "develop"
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
