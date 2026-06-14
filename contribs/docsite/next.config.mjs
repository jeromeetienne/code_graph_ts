import nextra from 'nextra';

const withNextra = nextra({});

// Apply the GitHub Pages basePath only when building inside GitHub Actions
// (the runner always sets GITHUB_ACTIONS=true). Local `next build` / `next dev`
// then produce a root-relative site, so `npm run start` (serve ./out) works at
// http://localhost:3000 without the /ts_knowledge_graph prefix breaking assets.
const basePath = process.env.GITHUB_ACTIONS === 'true' ? '/ts_knowledge_graph' : '';

export default withNextra({
	output: 'export',
	basePath,
	images: { unoptimized: true },
	trailingSlash: true,
});
