# Security policy

## Reporting a vulnerability

Please report privately. Do not open a public issue for a security problem.

- Preferred: GitHub private vulnerability reporting on the repository (Security → Report a vulnerability), once the
  repository is public.
- Alternative: email the maintainer. **Contact address: OWNER TO CONFIRM** — the project's public address is
  `tab@chemdft.com`; whether it should be the security contact has not been decided, and no dedicated security address is
  invented here.

Please include what you did, what happened, and what you expected. A reproduction is worth more than a severity score.

## What to expect

This is a one-person project with no on-call rotation. Acknowledgement is best effort; there is no bug bounty and no
guaranteed response time. Do not test against the live service in ways that touch other users' data.

## Scope

In scope: authentication and authorisation, tenant isolation between accounts, the Result Firewall and provenance
records, file import (CIF, XYZ, SDF, MOL), export generation, the AI gateway's handling of prompts and results, and any
way to make the platform display a scientific value that no engine produced.

Out of scope: denial of service by volume, reports from automated scanners without a demonstrated impact, and anything
that requires the owner's own credentials.

## Please do not

- Access, modify or exfiltrate another user's data, even to prove a point; stop at the first indication and report it.
- Run resource-heavy jobs against the hosted service.
- Publish details before a fix is available.

## Known limitations, stated openly

Two-account isolation has offline test coverage but has **not** been verified live, and the AI-planned proposal path has
not been verified on the hosted platform. See the release notes on the website.
