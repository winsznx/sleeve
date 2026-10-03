import type { NavIconName } from './glyphs';

/** One place in the app's navigation. */
export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  /** One line on what the place holds, for the search palette. */
  description?: string;
  /** Other words people search for it by. */
  keywords?: readonly string[];
}

/** A path that belongs to a place without being in the navigation, such as /sell under Holdings. */
export interface SectionAlias {
  prefix: string;
  /** The href of the place it belongs to. */
  section: string;
  /** The crumb for the prefix itself; pages under it show their last segment. */
  label?: string;
  /** Put before the last segment of a page under the prefix, such as "#" for an action number: "#642". */
  segmentPrefix?: string;
}

/** A place and the page under it the path names, or null when the path is the place itself. */
export interface CurrentSection {
  item: NavItem;
  trail: string | null;
}

/** A path is in a section when it is the section or a page under it, never a sibling that shares a prefix. */
export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function lastSegment(pathname: string): string {
  const segment = pathname.split('/').filter((part) => part !== '').at(-1) ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Which place a path belongs to, for the rail, the bottom bar and the breadcrumb. */
export function currentSection(
  pathname: string,
  items: readonly NavItem[],
  aliases: readonly SectionAlias[] = [],
): CurrentSection | null {
  const direct = items.find((item) => isCurrentPath(pathname, item.href));
  if (direct !== undefined) return { item: direct, trail: pathname === direct.href ? null : lastSegment(pathname) };
  for (const alias of aliases) {
    if (!isCurrentPath(pathname, alias.prefix)) continue;
    const item = items.find((candidate) => candidate.href === alias.section);
    if (item === undefined) continue;
    if (pathname === alias.prefix) return { item, trail: alias.label ?? null };
    return { item, trail: `${alias.segmentPrefix ?? ''}${lastSegment(pathname)}` };
  }
  return null;
}
