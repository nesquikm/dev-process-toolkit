// atlassian_site — STE-871. The declared Jira site's value formats: `site` (a
// host) and `cloud_id` (a UUID) under `task_tracking.jira`. Import-free, so the
// settings loader and the tracker-write hook can both load it.

const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored form of a declared `site`: lower case. */
export function normalizeSite(site: string): string {
  return site.trim().toLowerCase();
}

/** True for a bare, dotted, lower-case host: no scheme, userinfo, port, path or trailing dot. */
export function isSiteHost(site: string): boolean {
  return HOST_RE.test(site);
}

/** True for a UUID in the hyphenated form, in either case. */
export function isCloudId(value: string): boolean {
  return UUID_RE.test(value);
}

/** The declared site of one Jira binding; both fields are optional. */
export interface SiteDeclaration {
  readonly site?: string | null;
  readonly cloudId?: string | null;
}

/** ASCII-only equality in any case: `toLowerCase` folds some non-ASCII letters onto ASCII ones. */
function sameAscii(value: string, declared: string): boolean {
  return /^[\x21-\x7e]+$/.test(value) && value.toLowerCase() === declared.toLowerCase();
}

/**
 * The raw authority of an `https` URL, or null. Not `new URL`, which normalises:
 * userinfo, a port, a trailing dot or a backslash stays in and fails the comparison.
 */
function httpsAuthority(url: string): string | null {
  return /^https:\/\/([^/?#]*)/i.exec(url)?.[1] ?? null;
}

/**
 * The host or id a call's `cloudId` value names, as `siteMatches` reads it: the
 * authority of an `https` URL (its path ignored), else the value; lower case.
 */
export function siteHostOf(value: string): string {
  return (httpsAuthority(value) ?? value).toLowerCase();
}

/** True when a call's `cloudId` names the declared site, or when no site is declared. */
export function siteMatches(binding: SiteDeclaration, cloudId: unknown): boolean {
  if (!binding.site && !binding.cloudId) return true;
  if (typeof cloudId !== "string") return false;
  if (binding.cloudId && sameAscii(cloudId, binding.cloudId)) return true;
  return !!binding.site && sameAscii(httpsAuthority(cloudId) ?? cloudId, binding.site);
}

/** True when a browse URL is on the declared host, or when no `site` is declared. */
export function browseHostMatches(binding: SiteDeclaration, url: string): boolean {
  if (!binding.site) return true;
  const authority = httpsAuthority(url);
  return authority !== null && sameAscii(authority, binding.site);
}
