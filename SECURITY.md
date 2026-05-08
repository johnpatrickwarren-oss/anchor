# Security Policy

## Reporting a vulnerability

Anchor is a methodology pack — templates, documentation, case studies — not a code library with runtime. The security surface is small (CI workflows if any; supply chain via tools used to render docs).

If you find a security issue (CI vulnerability, supply chain risk, malicious link in templates, sensitive content inadvertently included):

1. **GitHub private vulnerability reporting** (preferred):
   <https://github.com/johnpatrickwarren-oss/anchor/security/advisories/new>

2. **Email**: john.patrick.warren+anchor-security@gmail.com

What to include:

- Description
- Steps to reproduce / locate
- Affected commit SHAs
- Potential impact
- Suggested fix (optional)

## Scope

**In scope:**

- CI / build pipeline vulnerabilities (`.github/workflows/`, if any)
- Supply chain risks (any executable tooling included in the pack)
- Malicious content in templates / case studies (links to exploitable resources)
- Sensitive content disclosure (private context inadvertently included in templates or case studies)

**Out of scope:**

- Methodology disagreements — file an issue
- Templates that recommend technical practices you disagree with — file an issue with rationale
- Generic "this could be done better" — file an issue
- Anything in adopters' implementations of the methodology — out of scope; that's their security surface

## Response

- Acknowledgment: within 1 week
- Triage: within 2 weeks
- Fix: timeline depends on severity (typically days; methodology pack vulnerabilities are usually low-impact)

## Versions supported

Only the latest commit on `main` is supported.

## Past advisories

(Empty.)
