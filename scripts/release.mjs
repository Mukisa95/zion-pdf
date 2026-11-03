// Publish a new Zion PDF version for Windows, macOS, and Linux:
//   1. bump the version and tag it, then push the source and tag to the configured GitHub repository;
//   2. the "Release build" workflow (.github/workflows/release-build.yml) builds and checks the installers
//      for every platform on GitHub Actions;
//   3. this script downloads them and publishes a release in the same repository.
// Installed copies pick the update up automatically (electron-updater reads latest*.yml from the release).
//
//   npm run release                      # 1.0.0 -> 1.0.1
//   npm run release -- minor             # 1.0.0 -> 1.1.0
//   npm run release -- patch --notes "Faster search, fixed printing"
//
// If a run fails after the tag is pushed, fix the problem and publish that same tag with:
//   npm run release -- --publish-only
import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { checkRelease, RELEASES_REPO, REQUIRED_ASSETS } from "./check-release.mjs";

const SOURCE_REPO = RELEASES_REPO;
const WORKFLOW = "release-build.yml";
const DOWNLOADS = "release-dist";

const args = process.argv.slice(2);
if (args.includes("--windows-preview")) {
  await import("./release-windows-preview.mjs");
  process.exit(0);
}
const notesAt = args.indexOf("--notes");
const notes = notesAt >= 0 ? args[notesAt + 1] : "";
const publishOnly = args.includes("--publish-only");
const bump = args.find((a, i) => !a.startsWith("--") && i !== notesAt + 1) || "patch";
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  console.error(`Unknown version bump "${bump}". Use patch, minor, major, or an exact version like 2.0.0.`);
  process.exit(1);
}

// ELECTRON_RUN_AS_NODE (set by some hosts) makes Electron tooling behave like plain Node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
// Arguments are passed directly (no shell), so values like release notes can contain any characters.
const gh = (ghArgs, opts = {}) => execFileSync("gh", ghArgs, { env, encoding: "utf8", ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!publishOnly) {
  const configured = JSON.parse(readFileSync("package.json", "utf8")).build?.publish;
  if (`${configured?.owner}/${configured?.repo}`.toLowerCase() !== SOURCE_REPO.toLowerCase()) {
    throw new Error("The update repository in package.json does not match the GitHub origin.");
  }
  const secretNames = gh(["secret", "list", "--repo", SOURCE_REPO]);
  if (!/^APT_SIGNING_KEY\s/m.test(secretNames)) {
    throw new Error("Configure APT_SIGNING_KEY and the matching Linux public key before starting a release. See SIGNING.md.");
  }
  if (execSync("git status --porcelain").toString().trim()) {
    console.error("Commit or stash your changes first — a release is built from committed code.");
    process.exit(1);
  }
  // Releases come from main as pushed. Compare commits rather than branch names, since a worktree's branch
  // often isn't called "main".
  run("git fetch --quiet origin main");
  if (execSync("git rev-parse HEAD").toString().trim() !== execSync("git rev-parse origin/main").toString().trim()) {
    console.error("This checkout isn't at the latest main. Merge your work into main, then release from it, for example:\n"
      + "  git worktree add ../zionpdf-release origin/main && cd ../zionpdf-release && npm run release");
    process.exit(1);
  }
  run(`npm version ${bump} -m "Release v%s"`);
}
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${version}`;
// Pushing the tag starts the cross-platform build. Name the target explicitly so this works from any local branch.
if (!publishOnly) run(`git push origin HEAD:main refs/tags/${tag}`);

// Find the build for this tag (it can take a few seconds to appear), then wait for it.
console.log(`\nWaiting for the ${tag} build on GitHub Actions…`);
let runId = null;
for (let i = 0; i < 60 && !runId; i++) {
  const runs = JSON.parse(gh(["run", "list", "--repo", SOURCE_REPO, "--workflow", WORKFLOW, "--branch", tag, "--limit", "5",
    "--json", "databaseId,headBranch,createdAt"]));
  runId = runs.find((r) => r.headBranch === tag)?.databaseId ?? null;
  if (!runId) await sleep(5000);
}
if (!runId) {
  console.error(`No "${WORKFLOW}" run found for ${tag}. Check https://github.com/${SOURCE_REPO}/actions`);
  process.exit(1);
}
console.log(`Build: https://github.com/${SOURCE_REPO}/actions/runs/${runId}`);
try {
  gh(["run", "watch", String(runId), "--repo", SOURCE_REPO, "--exit-status", "--interval", "20"], { stdio: "inherit" });
} catch {
  console.error(`\nThe ${tag} build failed, so nothing was published. Fix it, then run: npm run release -- --publish-only`);
  process.exit(1);
}

// Download every platform's installers.
rmSync(DOWNLOADS, { recursive: true, force: true });
gh(["run", "download", String(runId), "--repo", SOURCE_REPO, "--dir", DOWNLOADS], { stdio: "inherit" });
const files = readdirSync(DOWNLOADS, { recursive: true })
  .map((f) => path.join(DOWNLOADS, f))
  .filter((f) => statSync(f).isFile());
// Every platform ships together: refuse to publish unless the build produced all of them.
const missing = REQUIRED_ASSETS.map((a) => a.name).filter((name) => !files.some((f) => path.basename(f) === name));
if (missing.length) {
  console.error(`Missing from the build: ${missing.join(", ")}. Nothing was published.`);
  process.exit(1);
}

// Mac builds are signed and notarized once the Developer ID secrets exist (see SIGNING.md).
const macSigned = gh(["secret", "list", "--repo", SOURCE_REPO]).includes("MAC_CERTIFICATE_P12_BASE64");
const body = [
  notes || `Zion PDF ${version}.`,
  "",
  "## Download",
  "- **Windows:** **Zion-PDF-Setup.exe**, or **Zion-PDF-Portable.exe** to run without installing.",
  macSigned
    ? "- **macOS:** **Zion-PDF-mac.dmg** (Apple Silicon and Intel)."
    : "- **macOS:** **Zion-PDF-mac.dmg** (Apple Silicon and Intel). The first time you open it, macOS may block it because it isn't notarized: open **System Settings → Privacy & Security** and click **Open Anyway**.",
  "- **Linux:** **Zion-PDF-linux-amd64.deb** for Ubuntu/Debian, or **Zion-PDF-linux-x86_64.AppImage** for other distributions.",
  "- **Source code:** GitHub's **Source code (zip)** attachment.",
].join("\n");
gh(["release", "create", tag, "--repo", RELEASES_REPO, "--title", `Zion PDF ${version}`, "--notes", body, ...files], { stdio: "inherit" });

// Double-check what actually got published: every file present, every update feed at this version.
const { problems } = await checkRelease(tag);
if (problems.length) {
  console.error(`\nPublished, but the release is incomplete:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log(`\nZion PDF ${version} is live for Windows, macOS, and Linux: https://github.com/${RELEASES_REPO}/releases/tag/${tag}`);
