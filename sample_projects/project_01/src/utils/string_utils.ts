import { ELLIPSIS } from '../shared/constants.js';
import type { TruncateOptions } from '../shared/types.js';

/** Pure, side-effect-free string helpers. */
export class StringUtils {
	/** Upper-case the first character, leaving the rest unchanged. */
	static capitalize(value: string): string {
		if (value.length === 0) {
			return value;
		}
		return value[0].toUpperCase() + value.slice(1);
	}

	/** Collapse runs of whitespace into a single space, then trim. */
	static normalizeWhitespace(value: string): string {
		return value.replace(/\s+/g, ' ').trim();
	}

	/** Title-case each whitespace-separated word. */
	static titleCase(value: string): string {
		return StringUtils.normalizeWhitespace(value)
			.split(' ')
			.map((word) => StringUtils.capitalize(word))
			.join(' ');
	}

	/**
	 * Pick the ellipsis string, falling back to {@link ELLIPSIS}.
	 *
	 * Incidental optimisation target: a single-use helper called only from
	 * {@link StringUtils.truncate}, so `who-calls` returns exactly one caller —
	 * a natural inline candidate.
	 */
	static ellipsisFor(options: TruncateOptions): string {
		return options.ellipsis.length > 0 ? options.ellipsis : ELLIPSIS;
	}

	/** Truncate to a maximum length, appending an ellipsis when shortened. */
	static truncate(value: string, options: TruncateOptions): string {
		const normalized = StringUtils.normalizeWhitespace(value);
		if (normalized.length <= options.length) {
			return normalized;
		}
		return normalized.slice(0, options.length) + StringUtils.ellipsisFor(options);
	}

	/** Convert to a lower-case, dash-separated slug. */
	static slugify(value: string): string {
		return StringUtils.normalizeWhitespace(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}
}
