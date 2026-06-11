/** A grouping of values keyed by a derived string. */
export type Grouped<T> = Record<string, T[]>;

/** Options controlling how {@link StringUtils.truncate} shortens a string. */
export type TruncateOptions = {
	length: number;
	ellipsis: string;
};

/**
 * Casing styles for string transforms.
 *
 * Deliberately dead: this type alias is exported but referenced by nothing in
 * `src` or `tests`. It exists so `dead-exports` has a genuine unused type to
 * report (no inbound `USES_TYPE` / `PARAM_TYPE` / `RETURNS` edge).
 */
export type CaseStyle = 'lower' | 'upper' | 'title';
