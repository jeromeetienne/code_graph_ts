# `web`

Serve the knowledge graph database in an interactive web visualisation — pan and
zoom, filter by node kind, search symbols, and inspect a node's edges.

Source: [`src/commands/web_command.ts`](../../src/commands/web_command.ts) ·
front-end: [`contribs/web_visualisation`](../../contribs/web_visualisation)

## Synopsis

```bash
npx ts-knowledge-graph web [options]
```

## Arguments

None.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `-d, --db <path>` | `./outputs/graph.kuzu` | Kùzu database path to visualise. |
| `-p, --port <port>` | `4173` | HTTP port to listen on. |

## What it does

1. Resolves the database path and checks it exists. If not, it prints an error
   (`database not found … — run extract then load first`), sets exit code `1`,
   and returns.
2. **Reads the whole graph once at startup.** It opens the Kùzu store and runs
   two Cypher queries — one for all nodes, one for all edges — then serializes
   the result into a JavaScript snippet that assigns `window.GRAPH_DATA`. It logs
   how many nodes and edges were loaded.
3. Starts a plain Node `http` server:
   - `GET /data/graph_data.js` returns the in-memory graph snippet. This is the
     script the page loads on boot.
   - Every other path is served as a static file from the bundled
     `contribs/web_visualisation/web` directory (`/` maps to `index.html`).
   - The static file path is normalized and confined to the web root, so
     requests cannot escape the directory with `..` traversal. Anything outside
     it, or any missing file, returns `404 not found`.
4. Prints the URL and waits. Stop it with `Ctrl+C`.

Served MIME types cover `.html`, `.css`, `.js`, `.json`, `.png`, and `.svg`;
anything else falls back to `application/octet-stream`.

## Output

```
loaded ~390 nodes, ~1.3k edges from /…/outputs/graph.kuzu
✓ serving the knowledge graph at http://localhost:4173/
  press Ctrl+C to stop
```

## Examples

```bash
# serve the default database on the default port
npx ts-knowledge-graph web

# choose a database and port
npx ts-knowledge-graph web --db ./outputs/graph.kuzu --port 8080
```

## Notes and caveats

- **The graph is read once, at startup.** Edits to the database after the server
  starts are not reflected — re-run [`extract`](extract.md) and
  [`load`](load.md), then restart `web` to see changes.
- The whole graph is sent to the browser in one payload. This is fine for the
  graphs this tool produces; very large graphs will produce a large initial
  download.
- Holding the database open here can block a concurrent [`load`](load.md). Stop
  the server before reloading.
- The static assets are resolved relative to the command's own module, so the
  same command works both from `src/` (via `tsx`) and from the published `dist/`
  package.

## See also

- [`load`](load.md) — build the database `web` serves.
- [`contribs/web_visualisation`](../../contribs/web_visualisation) — the
  front-end this command serves.
