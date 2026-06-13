/** A minimal Express-style request, enough to type the simulated server's handlers. */
export type Request = {
	params: Record<string, string>;
	body: unknown;
};

/** A minimal Express-style response. */
export type Response = {
	json: (body: unknown) => void;
	send: (body: unknown) => void;
};

/** A route handler: receives a request and a response. */
export type RouteHandler = (req: Request, res: Response) => void | Promise<void>;

/** A minimal router exposing the HTTP-verb registration methods this server uses. */
export type Router = {
	get: (path: string, handler: RouteHandler) => void;
	post: (path: string, handler: RouteHandler) => void;
};
