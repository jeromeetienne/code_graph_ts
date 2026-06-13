import type { Request, Response } from '../types/http.js';
import type { ResourceProfile } from '../types/capacity.js';

/** Per-request resource cost of full-text search (CPU-heavy ranking). */
export const SEARCH_PROFILE: ResourceProfile = { cpu: 35, network: 25, disk: 2 };

/** `GET /search` — rank products against a query string. */
export function searchProducts(req: Request, res: Response): void {
	res.json({ query: req.params.q ?? '', results: [] });
}
