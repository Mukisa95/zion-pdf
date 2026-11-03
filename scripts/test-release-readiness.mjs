import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseRepository } from "./release-repository.mjs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const workflow = readFileSync(".github/workflows/release-build.yml", "utf8");
const repo = releaseRepository();
assert.equal(repo.toLowerCase(), `${pkg.build.publish.owner}/${pkg.build.publish.repo}`.toLowerCase());
for (const name of [pkg.build.nsis.artifactName, pkg.build.portable.artifactName, pkg.build.dmg.artifactName, pkg.build.appImage.artifactName, pkg.build.deb.artifactName]) {
  assert.ok(workflow.includes(`release/${name}`), `${name} is missing from the release workflow`);
}
assert.ok(!Array.isArray(pkg.build.linux.extraResources), "Linux must inherit the bundled offline converter resources");
assert.match(readFileSync(".gitignore", "utf8"), /conversion\/runtime\//);
console.log(`PASS: ${repo}, installer names, offline converter packaging, and ignored build output`);
