# Web visualisation

Interactive viewer for the knowledge graph — pan/zoom, color-coded node and
edge kinds with toggleable filters, symbol search, and a per-node detail panel
showing every incoming/outgoing edge.

**No server required.** The page (in [web/](web)) is fully static; only the
Cytoscape.js library comes from a CDN (so you need internet, or vendor the
file).

## Commands

```bash
npm run build    # embed ../../outputs/graph/*.jsonl into web/data/graph_data.js
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
- **Edge width** scales with call-site count — how many times the call / import /
  read occurs between the two symbols (shown as `×N` in the detail panel). Thick
  edges are the hot connections.
- Uncheck noisy kinds (`CONTAINS`, `IMPORTS`) to see the behavioral core;
  enable **hide isolated nodes** to drop whatever the filter disconnected.
- The **all** checkbox atop Node kinds / Edge kinds toggles every kind at once —
  hide all, then re-check just the few you want to isolate (it shows a dash when
  only some kinds are visible).
- Click a node to fade everything outside its neighborhood and list its edges
  in the sidebar — the links navigate the graph.
- **Fold any sidebar section** by clicking its header (Runtime, Hotspots, Node
  kinds, Edge kinds, …); the collapsed state is remembered across reloads.

## Runtime hotspots

When the graph has been enriched (`ts-knowledge-graph enrich <profile.cpuprofile>`),
each measured symbol carries `metadata.runtime` (self-time + sample count). The
sidebar's **Runtime** panel surfaces it:

- **Coverage line** — how many nodes were measured and the total self-time, so a
  partial profile reads as partial.
- **Heat map toggle** — re-encodes the graph by measured self-time: nodes are
  **sized and heat-coloured** (cool → yellow → red) by how hot they are, instead
  of by kind/degree. Toggle off to return to the structural view.
- **Hotspots list** — the top symbols ranked by self-time; click one to focus it.
- **Only measured nodes** — hides the un-enriched nodes so only the measured
  subgraph remains, to focus on where the cost actually is.
- Selecting any node adds a **runtime** block (self-time, samples, source) to the
  detail panel.

Un-measured nodes render at a neutral, dashed baseline — "no metric" means
*inlined or not sampled*, not "free".
