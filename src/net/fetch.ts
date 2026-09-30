/**
 * The fetch signature the data clients take, so tests can route requests to fakes instead of
 * the network.
 */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
