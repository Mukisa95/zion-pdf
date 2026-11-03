#!/usr/bin/env bash
# Turns the Linux .deb into signed apt repository metadata for a GitHub release.
#
# Needs dpkg-dev, apt-utils, and gnupg, plus the armored private signing key in $APT_SIGNING_KEY.
# Writes release/Packages, Packages.gz, Release, InRelease, and Release.gpg.
set -euo pipefail
cd "$(dirname "$0")/../release"
: "${APT_SIGNING_KEY:?APT_SIGNING_KEY (armored private key) is required}"
version=$(node -p 'require("../package.json").version')

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp Zion-PDF-linux-amd64.deb "$work/"
(cd "$work" && dpkg-scanpackages --multiversion . /dev/null > Packages 2>/dev/null)
gzip -9nc "$work/Packages" > "$work/Packages.gz"
(cd "$work" && apt-ftparchive \
  -o APT::FTPArchive::Release::Origin="Zion PDF" \
  -o APT::FTPArchive::Release::Label="Zion PDF" \
  -o APT::FTPArchive::Release::Suite="stable" \
  -o APT::FTPArchive::Release::Codename="stable" \
  -o APT::FTPArchive::Release::Version="$version" \
  -o APT::FTPArchive::Release::Architectures="amd64" \
  -o APT::FTPArchive::Release::Description="Zion PDF reader" \
  release . > Release)

export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
printf '%s\n' "$APT_SIGNING_KEY" | gpg --batch --quiet --import
expected=$(gpg --batch --show-keys --with-colons ../build/linux/folio-archive-keyring.gpg | awk -F: '$1 == "fpr" { print $10; exit }')
actual=$(gpg --batch --list-secret-keys --with-colons | awk -F: '$1 == "fpr" { print $10; exit }')
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "APT_SIGNING_KEY does not match build/linux/folio-archive-keyring.gpg." >&2
  exit 1
fi
gpg --batch --yes --pinentry-mode loopback --passphrase '' --clearsign -o "$work/InRelease" "$work/Release"
gpg --batch --yes --pinentry-mode loopback --passphrase '' --armor --detach-sign -o "$work/Release.gpg" "$work/Release"

cp "$work/Packages" "$work/Packages.gz" "$work/Release" "$work/InRelease" "$work/Release.gpg" .
grep -E "^(Package|Version|Filename|Size):" Packages
