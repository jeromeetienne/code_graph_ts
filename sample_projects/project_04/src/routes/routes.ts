import { health } from '../handlers/health.js';
import { createUser, listUsers } from '../handlers/users.js';
import type { Router } from '../types/types.js';

/** Registers every application route on the given router, each with a named handler. */
export function registerRoutes(router: Router): void {
	router.get('/users', listUsers);
	router.post('/users', createUser);
	router.get('/health', health);
}
