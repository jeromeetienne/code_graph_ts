import { fetchRepos } from '../clients/github.js';
import type { Request, Response } from '../types/types.js';

/** `GET /users` — list users together with their repositories. */
export async function listUsers(req: Request, res: Response): Promise<void> {
	const repos = await fetchRepos('octocat');
	res.json(repos);
}

/** `POST /users` — create a user. */
export function createUser(req: Request, res: Response): void {
	res.json({ created: true, body: req.body });
}
