import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("scoped package is configured for public npm publish", () => {
  assert.equal(packageJson.name, "@lilpacy/setup-github-rules");
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.deepEqual(packageJson.bin, {
    "setup-github-rules": "./bin/setup-github-rules.js"
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
