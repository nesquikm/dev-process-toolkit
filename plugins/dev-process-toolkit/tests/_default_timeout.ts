// Preloaded by bunfig.toml `[test] preload` (STE-685): bun does not apply the
// bunfig `[test] timeout` value itself, so set the per-test default here.
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(30_000);
