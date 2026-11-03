# Publishing Zion PDF

The intended source and releases repository is `https://github.com/Mukisa95/zion-pdf`. The local repository is configured with that address as `origin`. Preparing files locally does not create the remote repository, push source, or publish a release.

## Source and downloads

Create the GitHub repository as **public** when publication is authorized, then push the reviewed source to its `main` branch. GitHub supplies the **Code → Download ZIP** option for the source. A release in this same repository automatically offers **Source code (zip)** for its tag. The installer is a separate release asset named `Zion-PDF-Setup.exe`; do not commit the installer, `node_modules`, build output, test documents, or generated converter runtimes to Git.

The initial Windows-only release uses the self-contained local test installer at `release/Zion-PDF-Setup.exe`. Automatic updates are disabled in this build. Users must download a later installer to update. The release is clearly labeled Windows-only, and macOS and Linux packages are not yet available.

## Before publishing a release

- Review all source and assets that will be committed, including the original MIT copyright and third-party notices. Do not upload personal documents, credentials, or test output.
- Create the GitHub repository and establish `main`; confirm the remote points to the intended account before any push.
- Check the GitHub Actions builds and the packaged applications on Windows, macOS and Linux. Converter dependencies and model files are built separately for each platform by the workflow.
- Configure `APT_SIGNING_KEY` for the release workflow and replace the inherited Linux public key with the matching Zion PDF public key. Linux apt distribution must be verified before release; the current Linux install script does not configure an apt source automatically.
- Configure the optional Windows and macOS signing credentials in [SIGNING.md](../SIGNING.md) if signed installers are required. Without them the Windows installer is unsigned and the macOS app is not notarized.
- Confirm update metadata and GitHub release URLs point to this repository and test upgrades with a published test release before promising automatic updates. The local test installer does not update itself.

The initial Windows-only release was explicitly requested as an exception while the other platforms are being prepared. Its publishing command is `npm run release -- --windows-preview`. Later full releases follow the cross-platform process in [AGENTS.md](../AGENTS.md) and need explicit authorization. Do not run release commands merely to prepare a repository.
