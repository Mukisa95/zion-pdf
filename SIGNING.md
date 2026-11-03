# Code signing

The release workflow for `Mukisa95/zion-pdf` can sign installers when the corresponding GitHub Actions secrets are configured. Keep private keys and passwords outside the source repository.

## Linux apt signing (required for the existing cross-platform release workflow)

The inherited Linux public key belongs to the original project. Before releasing, create a Zion PDF signing key, replace `build/linux/folio-archive-keyring.gpg` and its armored `.asc` counterpart with the matching public key, and add the armored private key as the `APT_SIGNING_KEY` GitHub Actions secret. Keep a secure backup of the private key. The signing script checks that the configured private key matches the public key in the project.

The current `.deb` install script does not add an apt source automatically. Do not promise automatic apt updates until the repository configuration and upgrade path have been implemented and tested on Linux.

## Optional Windows signing

The workflow supports Azure Trusted Signing using `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, and `AZURE_SIGNING_PUBLISHER`. Without those credentials, Windows builds are unsigned.

## Optional macOS signing

The workflow supports an Apple Developer ID and notarization through `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Without them, macOS builds are ad-hoc signed and not notarized.

Set secrets only after the intended GitHub repository exists. Publishing a release requires explicit user authorization and the cross-platform checks in [AGENTS.md](AGENTS.md).
