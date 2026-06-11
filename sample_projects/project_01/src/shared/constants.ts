/** Default ellipsis appended by {@link StringUtils.truncate}. */
export const ELLIPSIS = '…';

/**
 * Default locale tag.
 *
 * Deliberately dead: exported but never read in `src` or `tests`, so it carries
 * no inbound `READS` edge. `dead-exports` should report it alongside the other
 * planted orphans.
 */
export const DEFAULT_LOCALE = 'en-US';
