/** Pure, side-effect-free object helpers. */
export class ObjectUtils {
	/** Return a shallow copy containing only the given keys. */
	static pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
		const result = {} as Pick<T, K>;
		for (const key of keys) {
			result[key] = source[key];
		}
		return result;
	}

	/** Return a shallow copy excluding the given keys. */
	static omit<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Omit<T, K> {
		const blocked = new Set<keyof T>(keys);
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(source) as (keyof T)[]) {
			if (blocked.has(key) === false) {
				result[key as string] = source[key];
			}
		}
		return result as Omit<T, K>;
	}
}
