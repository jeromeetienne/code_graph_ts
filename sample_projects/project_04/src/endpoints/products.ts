import type { Request, Response } from '../types/http.js';
import type { ResourceProfile } from '../types/capacity.js';

/** Per-request resource cost of the product-list query (disk/SQL-heavy). */
export const PRODUCTS_PROFILE: ResourceProfile = { cpu: 6, network: 40, disk: 8 };

/** Per-request resource cost of a single product fetch (a light keyed read). */
export const PRODUCT_PROFILE: ResourceProfile = { cpu: 3, network: 12, disk: 3 };

/** `GET /products` — list the product catalogue. */
export function listProducts(_req: Request, res: Response): void {
	res.json({ products: [] });
}

/** `GET /products/:id` — fetch a single product by id. */
export function getProduct(req: Request, res: Response): void {
	res.json({ id: req.params.id });
}
