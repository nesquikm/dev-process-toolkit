├── specs/                           # This repo's own SDD specs (frs/, plan/, requirements/technical/testing)
├── CHANGELOG.md
├── CLAUDE.md
├── README.md
└── LICENSE
```

## Release Notes

See [`CHANGELOG.md`](./CHANGELOG.md) for the full release history. Latest: **v2.99.2 — "Short Fuse"** (M_292387, test runs that cannot hang. Nested test runs and the gate carry hard time limits, the gate escalates SIGTERM to SIGKILL and names every failing test, and the supervisor mints the spawn receipt a worker cannot)

## Core Philosophy

Three layers prevent AI agents from going off the rails:

1. **Specs** — Human-written requirements are the source of truth
