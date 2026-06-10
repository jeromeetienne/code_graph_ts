# Web visualisation

Interactive viewer for the knowledge graph — pan/zoom, color-coded node and
edge kinds with toggleable filters, symbol search, and a per-node detail panel
showing every incoming/outgoing edge.

**No server required.** The page (in [web/](web)) is fully static; only the
Cytoscape.js library comes from a CDN (so you need internet, or vendor the
file).

## Commands

```bash
npm run build    # embed ../../outputs/graph/*.jsonl into web/data.js
npm start        # serve web/ on http://localhost:4173 (optional)
npm run open     # open web/index.html directly (file://, macOS)
```

## Loading data — pick one

**A. Embed the data, then open the page** (works from `file://`, no server):

```bash
# from the repo root, after `npm run extract -- . --semantic`
cd contribs/web_visualisation
npm run build
npm run open
```

`scripts/build-data.ts` reads `../../outputs/graph/{nodes,edges}.jsonl` by
default; pass a different graph directory as the first argument
(`npx tsx scripts/build-data.ts /path/to/graph`).

**B. Drag & drop** — open `web/index.html` any way at all and drop
`outputs/graph/nodes.jsonl` + `outputs/graph/edges.jsonl` onto the page.

**C. Serve the repo root** — the page then auto-fetches
`../../../outputs/graph/*.jsonl`:

```bash
# from the repo root
npx serve        # or: python3 -m http.server
# open http://localhost:3000/contribs/web_visualisation/web/
```

## Reading the graph

- **Node size** scales with degree (how connected a symbol is).
- **Edge colors**: red `CALLS`, green/teal type edges (`USES_TYPE`, `RETURNS`,
  `PARAM_TYPE`), yellow `READS`, violet heritage, gray structure
  (`CONTAINS`, `IMPORTS`).
- Uncheck noisy kinds (`CONTAINS`, `IMPORTS`) to see the behavioral core;
  enable **hide isolated nodes** to drop whatever the filter disconnected.
- Click a node to fade everything outside its neighborhood and list its edges
  in the sidebar — the links navigate the graph.
