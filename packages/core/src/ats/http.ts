export const USER_AGENT = "RemoteFit/0.1 (+https://github.com/JuanManuelRivera31/remotefit)";
export const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorDeps {
  fetch?: FetchLike;
}

/** Result of listing a board. `not_found` is a normal outcome (token wrong or board gone); any other failure throws. */
export type FetchJobsResult<T> = { status: "ok"; jobs: T[] } | { status: "not_found" };

export class ConnectorError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ConnectorError";
    this.status = status;
  }
}

/** GET a JSON document. Returns `null` on 404 and throws `ConnectorError` on every other failure. */
export async function getJson(url: string, deps: ConnectorDeps = {}): Promise<unknown> {
  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ConnectorError(
      `Request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new ConnectorError(`HTTP ${response.status} for ${url}`, response.status);
  return response.json();
}
