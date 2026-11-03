# Security policy

Please report suspected security vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Mukisa95/zion-pdf/security/advisories/new) once the repository is available. Include the Zion PDF version, steps to reproduce the issue, and a safe sample where possible. Avoid posting sensitive documents or exploit details in a public issue.

Zion PDF processes PDF files locally. Optional AI features send the information submitted for a question to the selected provider. Recent-file data and preferences are stored on the device. The application uses Electron isolation and restricts which operations are exposed to its interface, but no software can guarantee that a malicious document is harmless.

The present local Windows test installer is unsigned and does not update itself. Release signing and the Linux package signing key require separate configuration; see [Publishing](docs/PUBLISHING.md) and [SIGNING.md](SIGNING.md). Preserve the original project license and third-party notices when distributing source or installers.
