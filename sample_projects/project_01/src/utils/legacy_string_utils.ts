/**
 * Superseded string helpers kept from an earlier version of the library.
 *
 * Deliberately dead: this module is imported by nothing — not `index.ts`, not a
 * sibling module, not a test. Every member is therefore unreferenced, so
 * `dead-exports` should report the class as dead (no inbound `CALLS`,
 * `INSTANTIATES`, `READS`, or type edges reach it). It is the dominant planted
 * optimisation for this sample: a safe, whole-module deletion.
 */
export class LegacyStringUtils {
	/** Reverse the order of whitespace-separated words. */
	static reverseWords(value: string): string {
		return value.split(/\s+/).reverse().join(' ');
	}

	/** Count whitespace-separated words. */
	static wordCount(value: string): number {
		return value.split(/\s+/).filter((word) => word.length > 0).length;
	}
}
