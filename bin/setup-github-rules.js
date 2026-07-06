#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const API_VERSION = "2022-11-28";
const DEFAULT_RULESET_NAME_PREFIX = "Require PR to";
const MERGE_METHODS = new Set(["squash", "merge", "rebase"]);

export function parseArgs(argv) {
  const args = {
    repo: null,
    branch: null,
    approvals: null,
    mergeMethod: null,
    deleteBranchOnMerge: false,
    yes: false,
    dryRun: false,
    help: false,
    rulesetName: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--branch") args.branch = argv[++i];
    else if (arg === "--required-approvals") args.approvals = Number(argv[++i]);
    else if (arg === "--ruleset-name") args.rulesetName = argv[++i];
    else if (arg === "--merge-method") args.mergeMethod = argv[++i] ?? "";
    else if (arg === "--delete-branch-on-merge") args.deleteBranchOnMerge = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (args.approvals !== null && !isValidApprovalCount(args.approvals)) {
    throw new Error("--required-approvals must be an integer between 0 and 6.");
  }

  if (args.mergeMethod !== null && !MERGE_METHODS.has(args.mergeMethod)) {
    throw new Error("--merge-method must be one of: squash, merge, rebase.");
  }

  const selection = resolveSelection(args);
  if ((args.approvals !== null || args.rulesetName !== null) && !selection.branchProtection) {
    throw new Error("--required-approvals and --ruleset-name require --branch (branch protection).");
  }

  return args;
}

// Decides which settings to apply. Passing any setting flag narrows the run to
// just those settings; passing none applies the full interactive setup.
export function resolveSelection(args) {
  const settingFlagPresent =
    args.branch !== null || args.mergeMethod !== null || args.deleteBranchOnMerge;
  const applyAll = !settingFlagPresent;

  return {
    branchProtection: applyAll || args.branch !== null,
    deleteBranchOnMerge: applyAll || args.deleteBranchOnMerge,
    mergeMethod: applyAll || args.mergeMethod !== null
  };
}

function isValidApprovalCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function printHelp() {
  console.log(`setup-github-rules

One-shot GitHub repository setup using the GitHub CLI.

Usage:
  npx @lilpacy/setup-github-rules
  npx @lilpacy/setup-github-rules --repo OWNER/REPO
  npx @lilpacy/setup-github-rules --repo OWNER/REPO --branch develop --yes
  npx @lilpacy/setup-github-rules --repo OWNER/REPO --merge-method squash --yes
  npx @lilpacy/setup-github-rules --repo OWNER/REPO --delete-branch-on-merge --yes

Options:
  --repo OWNER/REPO              Target repository. Defaults to current git remote.
  --branch BRANCH                Default branch to set and protect with a PR-required ruleset.
  --required-approvals N         Required approving reviews. Requires --branch. If omitted, prompt with default 0.
  --ruleset-name NAME            Ruleset name. Requires --branch. Default: "Require PR to <branch>".
  --merge-method METHOD          Allow only one merge method: squash, merge, or rebase. If omitted, prompt with default: no change.
  --delete-branch-on-merge       Delete head branches automatically after Pull Requests are merged.
  --yes, -y                      Skip final confirmation.
  --dry-run                      Print planned operations without changing GitHub.
  --help, -h                     Show this help.

Applying settings selectively:
  With no setting flag, the full interactive setup runs (branch protection,
  delete-branch-on-merge, merge method, and any prompts). Passing any of
  --branch, --merge-method, or --delete-branch-on-merge narrows the run to
  just those settings.

What the full setup does:
  1. Detects or accepts OWNER/REPO.
  2. Lets you choose main, develop, or another default branch.
  3. Creates the branch from the current GitHub default branch if missing.
  4. Updates the repository default_branch.
  5. Enables automatic deletion of head branches after Pull Requests are merged.
  6. Lets you choose a merge method to allow, or leave it unchanged.
  7. Creates or updates a branch ruleset that requires Pull Requests.
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    input: options.input,
    cwd: options.cwd ?? process.cwd()
  });

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error([`Command failed: ${command} ${args.join(" ")}`, stderr, stdout].filter(Boolean).join("\n"));
  }

  return result.stdout?.trim() ?? "";
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "ignore" });
  return !result.error && result.status === 0;
}

export function parseGitHubRemoteUrl(remoteUrl) {
  const match = remoteUrl.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;

  throw new Error(`Could not detect OWNER/REPO from origin remote: ${remoteUrl}`);
}

function detectRepoFromGitRemote() {
  return parseGitHubRemoteUrl(run("git", ["remote", "get-url", "origin"]));
}

function splitRepo(repo) {
  const match = repo?.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) throw new Error("Repository must be in OWNER/REPO format.");
  return { owner: match[1], repo: match[2] };
}

function ghApi(endpoint, { method = "GET", body = null, silent404 = false } = {}) {
  const args = [
    "api",
    `--method=${method}`,
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    `X-GitHub-Api-Version: ${API_VERSION}`,
    endpoint
  ];

  let tempDir = null;
  try {
    if (body !== null) {
      tempDir = mkdtempSync(path.join(tmpdir(), "setup-github-rules-"));
      const bodyPath = path.join(tempDir, "body.json");
      writeFileSync(bodyPath, JSON.stringify(body, null, 2));
      args.push("--input", bodyPath);
    }

    const result = spawnSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status === 0) {
      const stdout = result.stdout.trim();
      return stdout ? JSON.parse(stdout) : null;
    }

    if (silent404 && result.stderr.includes("HTTP 404")) return null;

    throw new Error([`gh api failed: gh ${args.join(" ")}`, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"));
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

async function selectBranch(rl, preselectedBranch) {
  if (preselectedBranch) return preselectedBranch;

  console.log("\nChoose the repository default branch:");
  console.log("  1) main");
  console.log("  2) develop");
  console.log("  3) other");

  while (true) {
    const answer = (await rl.question("Select [1/2/3]: ")).trim();
    if (answer === "1" || answer.toLowerCase() === "main") return "main";
    if (answer === "2" || answer.toLowerCase() === "develop") return "develop";
    if (answer === "3" || answer.toLowerCase() === "other") {
      const branch = (await rl.question("Branch name: ")).trim();
      if (isValidBranchName(branch)) return branch;
      console.log("Please enter a valid branch name.");
      continue;
    }
    console.log("Please choose 1, 2, or 3.");
  }
}

export async function selectApprovals(rl, preselectedApprovals) {
  if (preselectedApprovals !== null) return preselectedApprovals;

  console.log("\nChoose the number of required approving reviews.");
  console.log("Use 0 for solo repositories where nobody else can approve your PR.");

  while (true) {
    const answer = (await rl.question("Required approvals [0-6] (default: 0): ")).trim();
    const approvals = answer === "" ? 0 : Number(answer);
    if (isValidApprovalCount(approvals)) return approvals;
    console.log("Please enter an integer between 0 and 6.");
  }
}

export async function resolveApprovals(rl, {
  preselectedApprovals,
  isInteractive
}) {
  if (preselectedApprovals !== null) return preselectedApprovals;
  if (!isInteractive) return 0;
  return selectApprovals(rl, null);
}

const MERGE_METHOD_CHOICES = { 1: "squash", 2: "merge", 3: "rebase" };

export async function selectMergeMethod(rl, preselectedMergeMethod) {
  if (preselectedMergeMethod) return preselectedMergeMethod;

  console.log("\nChoose the merge method to allow (restricts to one method).");
  console.log("  1) squash");
  console.log("  2) merge");
  console.log("  3) rebase");
  console.log("  4) no change");

  while (true) {
    const answer = (await rl.question("Select [1/2/3/4] (default: 4): ")).trim();
    if (answer === "" || answer === "4") return null;
    if (MERGE_METHOD_CHOICES[answer]) return MERGE_METHOD_CHOICES[answer];
    console.log("Please choose 1, 2, 3, or 4.");
  }
}

export async function resolveMergeMethod(rl, {
  preselectedMergeMethod,
  isInteractive
}) {
  if (preselectedMergeMethod !== null) return preselectedMergeMethod;
  if (!isInteractive) return null;
  return selectMergeMethod(rl, null);
}

function isValidBranchName(branch) {
  return Boolean(branch) &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.includes("..") &&
    !branch.includes(" ") &&
    !branch.includes("~") &&
    !branch.includes("^") &&
    !branch.includes(":") &&
    !branch.includes("?") &&
    !branch.includes("*") &&
    !branch.includes("[") &&
    !branch.includes("\\") &&
    !branch.endsWith(".lock");
}

function makeRulesetPayload({ branch, rulesetName, approvals }) {
  return {
    name: rulesetName,
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: [`refs/heads/${branch}`],
        exclude: []
      }
    },
    rules: [
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: approvals,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false
        }
      },
      { type: "deletion" },
      { type: "non_fast_forward" }
    ],
    bypass_actors: []
  };
}

function branchExists(owner, repo, branch) {
  return ghApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { silent404: true }) !== null;
}

export function makeRepositorySettingsPayload({
  selection,
  currentDefaultBranch = null,
  selectedBranch = null,
  mergeMethod = null
}) {
  const payload = {};

  if (selection.deleteBranchOnMerge) {
    payload.delete_branch_on_merge = true;
  }

  if (selection.branchProtection && currentDefaultBranch !== selectedBranch) {
    payload.default_branch = selectedBranch;
  }

  if (selection.mergeMethod && mergeMethod !== null) {
    payload.allow_merge_commit = mergeMethod === "merge";
    payload.allow_squash_merge = mergeMethod === "squash";
    payload.allow_rebase_merge = mergeMethod === "rebase";
  }

  return payload;
}

function createBranchFrom(owner, repo, newBranch, sourceBranch) {
  const sourceRef = ghApi(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`);
  ghApi(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: {
      ref: `refs/heads/${newBranch}`,
      sha: sourceRef.object.sha
    }
  });
}

function findExistingRuleset(owner, repo, rulesetName) {
  const rulesets = ghApi(`/repos/${owner}/${repo}/rulesets`);
  return Array.isArray(rulesets) ? rulesets.find((ruleset) => ruleset.name === rulesetName) : null;
}

async function confirmIfNeeded(args, deps) {
  if (args.yes) return true;

  const confirm = (await deps.question("\nApply these changes? [y/N]: ")).trim().toLowerCase();
  if (confirm === "y" || confirm === "yes") return true;

  deps.log("Cancelled. No changes were made.");
  return false;
}

export async function runSetup(args, deps) {
  const repoFullName = args.repo ?? deps.detectRepoFromGitRemote();
  const { owner, repo } = splitRepo(repoFullName);
  const selection = resolveSelection(args);
  const questionInterface = { question: deps.question };

  let currentDefaultBranch = null;
  let selectedBranch = null;
  let approvals = null;
  let rulesetName = null;
  let mergeMethod = null;

  if (selection.branchProtection) {
    const repoInfo = deps.ghApi(`/repos/${owner}/${repo}`);
    currentDefaultBranch = repoInfo.default_branch;
    selectedBranch = await selectBranch(questionInterface, args.branch);
    approvals = await resolveApprovals(questionInterface, {
      preselectedApprovals: args.approvals,
      isInteractive: Boolean(deps.inputIsTTY && deps.outputIsTTY)
    });
    rulesetName = args.rulesetName ?? `${DEFAULT_RULESET_NAME_PREFIX} ${selectedBranch}`;
  }

  if (selection.mergeMethod) {
    mergeMethod = await resolveMergeMethod(questionInterface, {
      preselectedMergeMethod: args.mergeMethod,
      isInteractive: Boolean(deps.inputIsTTY && deps.outputIsTTY)
    });
  }

  deps.log("\nPlan:");
  deps.log(`  Repository:           ${owner}/${repo}`);
  if (selection.branchProtection) {
    deps.log(`  Current default:      ${currentDefaultBranch}`);
    deps.log(`  New default:          ${selectedBranch}`);
    deps.log(`  Protected branch:     ${selectedBranch}`);
    deps.log(`  Required approvals:   ${approvals}`);
    deps.log(`  Ruleset name:         ${rulesetName}`);
  }
  if (selection.deleteBranchOnMerge) {
    deps.log("  Delete merged branch: enabled");
  }
  if (selection.mergeMethod) {
    deps.log(`  Merge method:         ${mergeMethod ?? "unchanged"}${mergeMethod ? " only" : ""}`);
  }

  if (args.dryRun) {
    deps.log("\nDry run only. No changes were made.");
    return;
  }

  if (!(await confirmIfNeeded(args, deps))) return;

  if (selection.branchProtection) {
    if (!deps.branchExists(owner, repo, selectedBranch)) {
      deps.log(`Creating branch '${selectedBranch}' from '${currentDefaultBranch}'...`);
      deps.createBranchFrom(owner, repo, selectedBranch, currentDefaultBranch);
    } else {
      deps.log(`Branch '${selectedBranch}' already exists.`);
    }

    if (currentDefaultBranch !== selectedBranch) {
      deps.log(`Setting default branch to '${selectedBranch}'...`);
    } else {
      deps.log(`Default branch is already '${selectedBranch}'.`);
    }
  }

  if (selection.deleteBranchOnMerge) {
    deps.log("Enabling automatic branch deletion after merge...");
  }
  if (selection.mergeMethod && mergeMethod !== null) {
    deps.log(`Restricting merge method to '${mergeMethod}'...`);
  }

  const repoSettings = makeRepositorySettingsPayload({
    selection,
    currentDefaultBranch,
    selectedBranch,
    mergeMethod
  });

  if (Object.keys(repoSettings).length > 0) {
    deps.ghApi(`/repos/${owner}/${repo}`, {
      method: "PATCH",
      body: repoSettings
    });
  }

  if (selection.branchProtection) {
    const payload = makeRulesetPayload({ branch: selectedBranch, rulesetName, approvals });
    const existing = deps.findExistingRuleset(owner, repo, rulesetName);

    if (existing) {
      deps.log(`Updating existing ruleset '${rulesetName}'...`);
      deps.ghApi(`/repos/${owner}/${repo}/rulesets/${existing.id}`, {
        method: "PUT",
        body: payload
      });
    } else {
      deps.log(`Creating ruleset '${rulesetName}'...`);
      deps.ghApi(`/repos/${owner}/${repo}/rulesets`, {
        method: "POST",
        body: payload
      });
    }
  }

  deps.log("\nDone.");
  if (selection.branchProtection) {
    deps.log(`Default branch '${selectedBranch}' now requires Pull Requests before changes can be merged.`);
  }
  if (selection.deleteBranchOnMerge) {
    deps.log("Merged Pull Request branches will be deleted automatically.");
  }
  if (selection.mergeMethod && mergeMethod !== null) {
    deps.log(`Only '${mergeMethod}' merges are allowed now.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!commandExists("git")) throw new Error("git is required.");
  if (!commandExists("gh")) throw new Error("GitHub CLI is required. Install gh and run `gh auth login` first.");

  run("gh", ["auth", "status"], { stdio: ["ignore", "ignore", "pipe"] });

  const rl = readline.createInterface({ input, output });
  try {
    await runSetup(args, {
      detectRepoFromGitRemote,
      ghApi,
      branchExists,
      createBranchFrom,
      findExistingRuleset,
      log: console.log,
      question: (prompt) => rl.question(prompt),
      inputIsTTY: input.isTTY,
      outputIsTTY: output.isTTY
    });
  } finally {
    rl.close();
  }
}

function isDirectExecution(argvPath, moduleUrl) {
  if (!argvPath) return false;
  return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  });
}
