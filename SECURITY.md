# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/room-impulse-lab/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static Room Impulse Lab browser application, including room-state bookmarks, acoustic simulation, ray-path rendering, report verification, WAV export, audio audition and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through room parameters, material labels, ray output, URL state, imported text or report output.
- A bookmark decoder or serialization flaw that bypasses validation, corrupts another room state, or executes attacker-controlled code.
- A CSV, JSON, SVG or WAV export flaw that makes generated output execute a formula or script when opened.
- A report fingerprint or verification flaw that accepts tampered acoustic output as authentic.
- An audio-generation boundary flaw that emits unsafe output levels or misrepresents local-only processing.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Accuracy limits documented for geometric acoustics and reverberation estimates, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
