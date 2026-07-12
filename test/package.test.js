import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("scoped package is configured for public npm publish", () => {
  assert.equal(packageJson.name, "@lilpacy/setup-github-rules");
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.deepEqual(packageJson.bin, {
    "setup-github-rules": "bin/setup-github-rules.js"
  });
});

test("npm pack dry-run includes only publishable files", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);

  const [packSummary] = JSON.parse(result.stdout);
  const packedFiles = packSummary.files.map((file) => file.path).sort();

  assert.deepEqual(packedFiles, [
    "LICENSE",
    "README.md",
    "bin/setup-github-rules.js",
    "package.json"
  ]);
});

test("packed tarball keeps a runnable bin path", () => {
  const packDir = mkdtempSync(path.join(tmpdir(), "setup-github-rules-pack-"));

  try {
    const packResult = spawnSync("npm", ["pack", "--json", "--pack-destination", packDir], {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_dry_run: "false"
      }
    });

    assert.equal(packResult.status, 0, packResult.stderr);

    const [{ filename }] = JSON.parse(packResult.stdout);
    const tarballPath = path.join(packDir, filename);
    const packageJsonResult = spawnSync("tar", ["-xOf", tarballPath, "package/package.json"], {
      encoding: "utf8"
    });

    assert.equal(packageJsonResult.status, 0, packageJsonResult.stderr);

    const packedManifest = JSON.parse(packageJsonResult.stdout);
    assert.deepEqual(packedManifest.bin, {
      "setup-github-rules": "bin/setup-github-rules.js"
    });
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
});

test("正常系: npx のように bin 経由で起動しても CLI として実行できる", () => {
  const binDir = mkdtempSync(path.join(tmpdir(), "setup-github-rules-bin-"));

  try {
    const binPath = path.join(binDir, "setup-github-rules");
    symlinkSync(new URL("../bin/setup-github-rules.js", import.meta.url), binPath);

    const result = spawnSync(process.execPath, [binPath, "--help"], {
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /setup-github-rules/);
    assert.match(result.stdout, /What the full setup does:/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("正常系: help を見れば直コミット許可の戻し方が分かる", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/setup-github-rules.js", import.meta.url)), "--help"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--allow-direct-commits/);
  assert.match(result.stdout, /accidentally required Pull Requests/);
  assert.match(result.stdout, /--branch BRANCH --allow-direct-commits --yes/);
  assert.match(result.stdout, /removes only the pull_request rule/);
});
