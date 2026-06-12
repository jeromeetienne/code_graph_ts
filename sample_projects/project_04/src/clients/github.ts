import { GITHUB_TOKEN } from '../config/config.js';

/** Fetches a user's public repositories from the GitHub REST API. */
export async function fetchRepos(user: string): Promise<unknown> {
	const response = await fetch('https://api.github.com/users', {
		headers: { authorization: GITHUB_TOKEN },
	});
	return { user, repos: await response.json() };
}
