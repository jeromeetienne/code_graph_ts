import { PORT } from '../config/config.js';
import type { Request, Response } from '../types/types.js';

/** `GET /health` — readiness probe reporting the configured port. */
export function health(req: Request, res: Response): void {
	res.json({ status: 'ok', port: PORT });
}
