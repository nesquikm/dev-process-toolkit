# `/spec-write` Reference

Reference material moved out of `skills/spec-write/SKILL.md` under NFR-1's overflow rule. Nothing here is a rule the skill needs at run time; the skill states every rule itself and points here for examples.

## FR frontmatter shapes

`buildFRFrontmatter(spec, trackerBinding?)` (`adapters/_shared/src/fr_frontmatter.ts`) writes the frontmatter; these shapes are illustrative only. Never author the YAML by hand.

```yaml
# mode: none — id required, no tracker block
---
title: <title>
milestone: <M<N>>
status: active
archived_at: null
id: fr_<26-char ULID>
created_at: <ISO timestamp>
---
```

```yaml
# tracker mode — id absent, compact tracker block
---
title: <title>
milestone: <M<N>>
status: active
archived_at: null
tracker:
  <mode>: <tracker-id>
created_at: <ISO timestamp>
---
```
