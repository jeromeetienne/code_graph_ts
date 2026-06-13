import type { Request, Response } from '../types/http.js';
import type { ResourceProfile } from '../types/capacity.js';

/** Per-request resource cost of a readiness probe (negligible). */
export const HEALTH_PROFILE: ResourceProfile = { cpu: 0.5, network: 1, disk: 0 };

/** `GET /health` — readiness probe. */
export function health(_req: Request, res: Response): void {
	res.json({ status: 'ok' });
}
