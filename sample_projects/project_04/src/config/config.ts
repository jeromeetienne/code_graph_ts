/** The port the server binds to, read from the environment. */
export const PORT = process.env.PORT ?? '3000';

/** Token used to authenticate outbound GitHub API calls. */
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
