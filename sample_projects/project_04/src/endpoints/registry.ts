import { listProducts, getProduct, PRODUCTS_PROFILE, PRODUCT_PROFILE } from './products.js';
import { createOrder, ORDERS_PROFILE } from './orders.js';
import { searchProducts, SEARCH_PROFILE } from './search.js';
import { health, HEALTH_PROFILE } from './health.js';
import type { Router } from '../types/http.js';
import type { RouteProfile } from '../types/capacity.js';

/** The per-request resource profiles the capacity simulator sums, one per registered route. */
export const ROUTE_PROFILES: RouteProfile[] = [
	{ route: 'GET /products', profile: PRODUCTS_PROFILE },
	{ route: 'GET /products/:id', profile: PRODUCT_PROFILE },
	{ route: 'POST /orders', profile: ORDERS_PROFILE },
	{ route: 'GET /search', profile: SEARCH_PROFILE },
	{ route: 'GET /health', profile: HEALTH_PROFILE },
];

/** Registers every route of the simulated LAMP server, each with a named handler. */
export function registerRoutes(router: Router): void {
	router.get('/products', listProducts);
	router.get('/products/:id', getProduct);
	router.post('/orders', createOrder);
	router.get('/search', searchProducts);
	router.get('/health', health);
}
