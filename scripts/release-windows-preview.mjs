// Explicitly requested initial Windows-only release. Later full releases use release.mjs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { releaseRepository } from "./release-repository.mjs";

const require = createRequire(import.meta.url);
const repo = releaseRepository();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const expectedHash = "D4D934019F86259860E5BCE46D6516CC775E3C58A044AB40624B7AC661AC0C58";
const file = path.resolve("release/Zion-PDF-Setup.exe");
const tag = `v${pkg.version}-windows`;
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim();
if (`${pkg.build.publish.owner}/${pkg.build.publish.repo}`.toLowerCase() !== repo.toLowerCase()) throw new Error("The configured update repository does not match origin.");
if (run("git", ["status", "--porcelain"])) throw new Error("Commit all changes before publishing the Windows release.");
const head = run("git", ["rev-parse", "HEAD"]);
const remote = run("git", ["rev-parse", "refs/remotes/origin/main"]);
if (head !== remote) throw new Error("Push and verify the current main branch before publishing.");
const packed = JSON.parse(require("@electron/asar").extractFile("release/win-unpacked/resources/app.asar", "package.json").toString());
if (packed.version !== pkg.version || packed.productName !== "Zion PDF" || packed.zionpdfLocalBuild !== true) throw new Error("The local test build does not match the source version or has unexpected update settings.");
const hash = createHash("sha256");
for await (const chunk of createReadStream(file)) hash.update(chunk);
const digest = hash.digest("hex").toUpperCase();
if (digest !== expectedHash) throw new Error("The installer differs from the Windows build selected for this release. Revalidate the build before publishing.");
const notes = [
  "## Windows installer",
  "Download **Zion-PDF-Setup.exe** to install Zion PDF on 64-bit Windows.",
  "",
  "This first release is for Windows. macOS and Linux installers will be published when ready.",
  "This Windows build includes the offline converter and OCR, and does not update itself. Download a later installer to update.",
  "The installer is unsigned. GitHub's **Source code (zip)** contains the source for this release and is not an installer.",
  "",
  `SHA-256: \`${digest}\``,
].join("\n");
mkdirSync(".converter-build", { recursive: true });
const notesFile = path.resolve(".converter-build/windows-release-notes.md");
writeFileSync(notesFile, notes, "utf8");
execFileSync("gh", ["release", "create", tag, file, "--repo", repo, "--target", head, "--title", `Zion PDF ${pkg.version} for Windows`, "--notes-file", notesFile, "--latest"], { stdio: "inherit", windowsHide: true });
const release = JSON.parse(run("gh", ["api", `repos/${repo}/releases/tags/${tag}`]));
const asset = release.assets?.find(item => item.name === path.basename(file));
if (release.draft || release.prerelease || !asset || asset.state !== "uploaded" || asset.size !== statSync(file).size || (asset.digest && asset.digest.toLowerCase() !== `sha256:${digest.toLowerCase()}`)) {
  throw new Error(`The release was created but verification failed. Review ${release.html_url || `https://github.com/${repo}/releases/tag/${tag}`} before sharing it.`);
}
console.log(`Verified Windows release: ${release.html_url}`);
