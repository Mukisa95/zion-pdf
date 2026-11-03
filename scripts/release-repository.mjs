import { execFileSync } from "node:child_process";

// Use the repository running the workflow, or this checkout's own GitHub origin.
// Never fall back to the upstream project's release account.
export function releaseRepository() {
  let repo = process.env.GITHUB_ACTIONS === "true" ? process.env.GITHUB_REPOSITORY : "";
  if (!repo) {
    let remote = "";
    try { remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* The checkout has not been connected yet. */ }
    repo = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(remote)?.[1] || "";
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Set the GitHub origin remote before building or checking a release.");
  }
  return repo;
}
