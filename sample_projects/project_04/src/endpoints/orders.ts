import type { Request, Response } from '../types/http.js';
import type { ResourceProfile } from '../types/capacity.js';

/** Per-request resource cost of placing an order (validate, persist, confirm). */
export const ORDERS_PROFILE: ResourceProfile = { cpu: 10, network: 20, disk: 6 };

/** `POST /orders` — place an order from the request body. */
export function createOrder(req: Request, res: Response): void {
	res.json({ created: true, order: req.body });
}
