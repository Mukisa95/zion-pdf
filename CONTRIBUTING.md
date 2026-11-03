# Contributing to Zion PDF

Please open an issue in the Zion PDF repository to discuss substantial changes. Do not include private PDFs, personal information, credentials, or signing keys in issues or commits. Report security issues using the private process in [SECURITY.md](SECURITY.md).

Install Node.js 22 or newer and run `npm ci`, `npx tsc --noEmit`, `npm run build`, and `npm run smoke`. The smoke test runs the desktop app off-screen. The offline converter has additional build requirements documented in [conversion/README.md](conversion/README.md).

Zion PDF shares a codebase across Windows, macOS and Linux. Keep operating-system behavior and keyboard shortcuts in mind when changing the desktop app. The release process and user authorization rules are in [AGENTS.md](AGENTS.md); release preparation is described in [docs/PUBLISHING.md](docs/PUBLISHING.md).
