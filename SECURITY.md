# Security

Auftakt is a local desktop application. It stores all data in a SQLite file on
your own machine and does not send anything to a server. The bundled Express
server listens on localhost only, for the app's own frontend.

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
private machine. Each release artifact carries a build provenance attestation
that ties it to the exact commit and workflow run that produced it.

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

## Scope

Auftakt has no authentication, no network sync and no multi-user separation —
it is a single-user local app, and anyone with access to your user account can
read the database. That is by design, not a vulnerability.
