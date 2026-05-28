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

export function parseArgs(argv) {
  const args = {
    repo: null,
    branch: null,
    approvals: null,
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
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (args.approvals !== null && !isValidApprovalCount(args.approvals)) {
    throw new Error("--required-approvals must be an integer between 0 and 6.");
  }

  return args;
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

Options:
  --repo OWNER/REPO              Target repository. Defaults to current git remote.
  --branch BRANCH                Default branch to set and protect. Skips branch prompt.
  --required-approvals N         Required approving reviews. If omitted, prompt with default 0.
  --ruleset-name NAME            Ruleset name. Default: "Require PR to <branch>".
  --yes, -y                      Skip final confirmation.
  --dry-run                      Print planned operations without changing GitHub.
  --help, -h                     Show this help.

What it does:
  1. Detects or accepts OWNER/REPO.
  2. Lets you choose main, develop, or another default branch.
  3. Creates the branch from the current GitHub default branch if missing.
  4. Updates the repository default_branch.
  5. Enables automatic deletion of head branches after Pull Requests are merged.
  6. Creates or updates a branch ruleset that requires Pull Requests.
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

function detectRepoFromGitRemote() {
  const remoteUrl = run("git", ["remote", "get-url", "origin"]);

  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;

  throw new Error(`Could not detect OWNER/REPO from origin remote: ${remoteUrl}`);
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

export function makeRepositorySettingsPayload({ currentDefaultBranch, selectedBranch }) {
  const payload = {
    delete_branch_on_merge: true
  };

  if (currentDefaultBranch !== selectedBranch) {
    payload.default_branch = selectedBranch;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!commandExists("git")) throw new Error("git is required.");
  if (!commandExists("gh")) throw new Error("GitHub CLI is required. Install gh and run `gh auth login` first.");

  run("gh", ["auth", "status"], { stdio: ["ignore", "ignore", "pipe"] });

  const repoFullName = args.repo ?? detectRepoFromGitRemote();
  const { owner, repo } = splitRepo(repoFullName);

  const rl = readline.createInterface({ input, output });
  try {
    const repoInfo = ghApi(`/repos/${owner}/${repo}`);
    const currentDefaultBranch = repoInfo.default_branch;
    const selectedBranch = await selectBranch(rl, args.branch);
    const approvals = await resolveApprovals(rl, {
      preselectedApprovals: args.approvals,
      isInteractive: Boolean(input.isTTY && output.isTTY)
    });
    const rulesetName = args.rulesetName ?? `${DEFAULT_RULESET_NAME_PREFIX} ${selectedBranch}`;

    console.log("\nPlan:");
    console.log(`  Repository:           ${owner}/${repo}`);
    console.log(`  Current default:      ${currentDefaultBranch}`);
    console.log(`  New default:          ${selectedBranch}`);
    console.log(`  Protected branch:     ${selectedBranch}`);
    console.log(`  Required approvals:   ${approvals}`);
    console.log(`  Ruleset name:         ${rulesetName}`);
    console.log("  Delete merged branch: enabled");

    if (args.dryRun) {
      console.log("\nDry run only. No changes were made.");
      return;
    }

    if (!args.yes) {
      const confirm = (await rl.question("\nApply these changes? [y/N]: ")).trim().toLowerCase();
      if (confirm !== "y" && confirm !== "yes") {
        console.log("Cancelled. No changes were made.");
        return;
      }
    }

    if (!branchExists(owner, repo, selectedBranch)) {
      console.log(`Creating branch '${selectedBranch}' from '${currentDefaultBranch}'...`);
      createBranchFrom(owner, repo, selectedBranch, currentDefaultBranch);
    } else {
      console.log(`Branch '${selectedBranch}' already exists.`);
    }

    if (currentDefaultBranch !== selectedBranch) {
      console.log(`Setting default branch to '${selectedBranch}'...`);
    } else {
      console.log(`Default branch is already '${selectedBranch}'.`);
    }

    console.log("Enabling automatic branch deletion after merge...");
    ghApi(`/repos/${owner}/${repo}`, {
      method: "PATCH",
      body: makeRepositorySettingsPayload({ currentDefaultBranch, selectedBranch })
    });

    const payload = makeRulesetPayload({ branch: selectedBranch, rulesetName, approvals });
    const existing = findExistingRuleset(owner, repo, rulesetName);

    if (existing) {
      console.log(`Updating existing ruleset '${rulesetName}'...`);
      ghApi(`/repos/${owner}/${repo}/rulesets/${existing.id}`, {
        method: "PUT",
        body: payload
      });
    } else {
      console.log(`Creating ruleset '${rulesetName}'...`);
      ghApi(`/repos/${owner}/${repo}/rulesets`, {
        method: "POST",
        body: payload
      });
    }

    console.log("\nDone.");
    console.log(`Default branch '${selectedBranch}' now requires Pull Requests before changes can be merged.`);
    console.log("Merged Pull Request branches will be deleted automatically.");
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
