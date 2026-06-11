import { StringUtils } from '../utils/string_utils.js';
import { ArrayUtils } from '../utils/array_utils.js';
import { ObjectUtils } from '../utils/object_utils.js';
import type { Grouped } from '../shared/types.js';

/** A document to summarise. */
export type Document = {
	title: string;
	body: string;
	tags: string[];
};

/** One word and how often it appears. */
export type WordStat = {
	word: string;
	count: number;
};

/**
 * Builds human-readable summaries from {@link Document} values.
 *
 * This is the library's internal consumer: it calls into {@link StringUtils},
 * {@link ArrayUtils}, and {@link ObjectUtils} from named methods, which is what
 * gives those classes genuine inbound `CALLS` edges. Without an internal
 * consumer a leaf utility library has no in-graph callers, so every public
 * export would look dead — only the deliberately planted orphans should.
 */
export class TextReport {
	/** Count how often each word appears in the body, most frequent first. */
	static wordStats(body: string): WordStat[] {
		const words = StringUtils.normalizeWhitespace(body).toLowerCase().split(' ');
		const grouped: Grouped<string> = ArrayUtils.groupBy(words, (word) => word);
		return ArrayUtils.unique(words)
			.map((word) => ({ word, count: grouped[word].length }))
			.sort((left, right) => right.count - left.count);
	}

	/** Render a one-line headline: a title-cased name, its slug, and a snippet. */
	static headline(document: Document): string {
		const title = StringUtils.titleCase(document.title);
		const slug = StringUtils.slugify(document.title);
		const snippet = StringUtils.truncate(document.body, { length: 40, ellipsis: '…' });
		return `${title} [${slug}] — ${snippet}`;
	}

	/** Project a document down to its citable fields. */
	static citation(document: Document): Pick<Document, 'title' | 'tags'> {
		return ObjectUtils.pick(document, ['title', 'tags']);
	}
}
