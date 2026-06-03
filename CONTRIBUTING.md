# Contributing to Anchor

Thanks for your interest. Anchor is the **behavioral half** of a two-part code-quality stack: a
small set of disciplines that still beat a strong base model's defaults, paired with
[sprag](https://github.com/johnpatrickwarren-oss/sprag) (the deterministic gate). The substance
is one file: [`DISCIPLINES.md`](DISCIPLINES.md).

Single maintainer; slower response times than active OSS projects.

## What this is

A deliberately short list of behavioral disciplines, each of which must pass **both** sieves:

1. **It can't be made deterministic** — else it belongs in sprag as an invariant, not here as prose.
2. **It still beats the base model's default** — else it's ceremony a strong model doesn't need.

## What this is NOT

- **Not a code library** — no runtime, no API surface.
- **Not the orchestrator** — the original five/six-role build-orchestration methodology and the
  `@anchor/*` tool are retired and archived, unmaintained, in [`legacy/`](legacy/). New
  contributions should target the behavioral pack, not the archive.
- **Not platform-specific** — the disciplines are model- and runtime-agnostic.

## The most valuable contributions

- **Half-life evidence.** Anchor's central claim is that each discipline beats the bare model
  default. If you can show — with a concrete before/after — that a current model *already* does one
  of these unprompted, that's grounds to retire the entry. This is the highest-value contribution:
  it keeps the pack from rotting into overhead.
- **A new incentive-fighting discipline.** Propose one only with: the structural incentive it
  fights (sycophancy, eagerness-to-finish, tunnel-vision, favorable framing, …), why it can't be a
  sprag gate (sieve 1), why a strong model won't do it unprompted (sieve 2), and a worked example.
- **Sharper phrasing or a better worked example** for an existing discipline.

## Submitting changes

File an issue first for anything structural (adding/removing a discipline). For phrasing,
examples, and half-life evidence, open a PR directly.

PR checklist:

- [ ] The change keeps `DISCIPLINES.md` short — additions justify their length against both sieves.
- [ ] A new discipline names the incentive it fights and includes a concrete example.
- [ ] Claims are precise and not overclaimed (evidence is labeled as such; N=1 is called N=1).
- [ ] Markdown renders cleanly.

## License

By contributing, you agree your contributions are licensed under the Apache License 2.0 (see
[`LICENSE`](LICENSE)).
