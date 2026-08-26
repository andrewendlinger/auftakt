# Security

Auftakt is a local desktop application. It stores all data in a SQLite file on
your own machine and never transmits it. The bundled Express server listens on
localhost only, for the app's own frontend.

The app makes exactly one outbound request: an automatic update check on
startup, which asks the GitHub Releases API for the latest published version
number. It sends no data of yours — see
[`electron/updateCheck.ts`](electron/updateCheck.ts) for the whole of it.

## Supported versions

Only the **latest release** receives fixes. Auftakt ships fix-forward: a defect
in a released version is fixed in a new release, never by re-tagging or
replacing a published installer — a published artefact and its provenance
attestation are immutable. The in-app updater moves existing installations to
the latest version; older installers stay downloadable for provenance, but
nothing is backported to them.

## Reporting a vulnerability

Please report security issues **privately**, not as a public issue.

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/andrewendlinger/auftakt/security/advisories/new)

Please include what you found, how to reproduce it, and what an attacker could
do with it. As this is a single-developer project, expect an initial reply
within a few days rather than a few hours.

## Verifying a download

Installers on the [Releases page](https://github.com/andrewendlinger/auftakt/releases)
are built by GitHub Actions from this repository's source — not uploaded from a
private machine. From v0.5.0 onward, each installer carries a build provenance
attestation that ties it to the exact commit and workflow run that produced it.
(Attestation requires a public repository, so releases cut while this repo was
private do not have one.)

In v0.5.0 the attestation covers the installers only. From v0.6.0 onward it also
covers `latest.yml` and the blockmaps — see "Windows installer and in-app
updates" below for why that distinction matters. The SBOMs attached to a release
are not attested; they describe the build rather than being installed by it.

Verify a download before installing it:

```bash
gh attestation verify Auftakt-*.dmg --repo andrewendlinger/auftakt
```

## macOS "damaged" warning

The app is **not** signed or notarized with an Apple Developer ID, so macOS
quarantines it after download and reports it as damaged. It is not damaged —
see the README for how to clear the quarantine flag. Publishing the full source
and the provenance attestation above is what stands in for Apple's notarization
here: you can read exactly what the app does and confirm the binary was built
from that source.

## Windows installer and in-app updates

The Windows installer is **not** Authenticode-signed, which has two consequences.
Windows SmartScreen warns about an unknown publisher on first install, and the
in-app updater (Settings → "Programm & Hilfe" → "Version & Updates", Windows only) cannot verify a
signature on the package it downloads — electron-updater skips that step when no
publisher is configured.

The installer and the app do name a publisher in their file properties, and
Windows shows it under "Apps & Features". That is **unverified metadata** — any
build can claim any name, and nothing checks it. It is not a signature, and it is
not what SmartScreen reads; SmartScreen still reports an unknown publisher.

What the update does check is the sha512 hash published in `latest.yml` in the
GitHub Release, fetched over HTTPS. From v0.6.0 onward every file the update path
touches carries a build provenance attestation — the installer, its blockmap, and
`latest.yml` itself, which is the file that names the binary the updater will
execute. In v0.5.0 only the installers were attested, so `latest.yml` from that
release cannot be verified this way.

**Attestation does not make the update path verify itself.** electron-updater
does not check attestations; it checks the sha512 in `latest.yml` against what it
downloaded. Attesting `latest.yml` therefore makes tampering *detectable by
someone who looks*, not *rejected at install*. Only a code signature would do the
latter.

So an update is only as trustworthy as this repository's GitHub Releases: anyone
able to replace both the installer and its `latest.yml` entry there could have
the updater install it. Publishing to a release is what that trust rests on.

If you would rather not rely on that, skip the in-app update: download the
installer from the Releases page yourself and verify it with
`gh attestation verify` before running it. That check is the one that reads the
attestation, which is why it is worth doing even though the updater cannot.

Signing needs a paid code-signing certificate, so this stays a known limitation
for now.

## Scope

Auftakt has no authentication, no network sync and no multi-user separation —
it is a single-user local app, and anyone with access to your user account can
read the database. That is by design, not a vulnerability.
