import { TextReport } from './report/text_report.js';
import type { Document } from './report/text_report.js';

/**
 * A tiny end-to-end example, runnable with `npm run dev` (or `npx tsx
 * src/main.ts`).
 *
 * It also roots the call graph: `main` is *not* exported, so `dead-exports`
 * never considers it, yet its calls give {@link TextReport} (and, transitively,
 * the utility classes) genuine inbound `CALLS` edges. This mirrors how an
 * application's non-exported entry point keeps its public surface from looking
 * dead — only the deliberately planted orphans remain unreferenced.
 */
function main(): void {
	const document: Document = {
		title: 'the quick brown fox',
		body: 'a a a b b c jumps over the lazy dog',
		tags: ['animals', 'demo'],
	};
	console.log(TextReport.headline(document));
	console.log(TextReport.wordStats(document.body));
	console.log(TextReport.citation(document));
}

main();
