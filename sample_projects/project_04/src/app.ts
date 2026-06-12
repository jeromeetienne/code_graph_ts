import { PORT } from './config/config.js';
import { registerRoutes } from './routes/routes.js';
import type { Request, Response, Router } from './types/types.js';

/** Wires the application routes onto a router, plus one inline route. */
export function createApp(router: Router): Router {
	registerRoutes(router);
	router.get('/ping', (req: Request, res: Response) => res.send('pong'));
	return router;
}

/** Entry point: builds the app and reports the port it would listen on. */
export function main(router: Router): void {
	createApp(router);
	console.log(`listening on ${PORT}`);
}
