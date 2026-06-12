/** A minimal Express-style request, enough to type the handlers in this fixture. */
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

/** A minimal router exposing the HTTP-verb registration methods this app uses. */
export type Router = {
	get: (path: string, handler: RouteHandler) => void;
	post: (path: string, handler: RouteHandler) => void;
};
