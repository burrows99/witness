import { Trace } from "../diagnostics/trace.ts";

/**
 * An HTTP API under test.
 *
 * Deliberately thin: a base URL, whatever auth the API wants, JSON in and out, and an error that says
 * which request failed and what the server said. Everything above that — routes, DTOs, the vocabulary of
 * the product — belongs in the app's own layer, which composes one of these.
 */
export class HttpApi {
  readonly baseUrl: string;

  private readonly defaults: () => RequestInit["headers"];
  private readonly trace?: Trace;

  constructor(baseUrl: string, defaults: () => RequestInit["headers"] = () => ({}), trace?: Trace) {
    this.baseUrl = baseUrl;
    this.defaults = defaults;
    this.trace = trace;
  }

  /**
   * Where a path lands, against this base URL.
   *
   * The separator is put in rather than assumed. `${base}${path}` is right for exactly one shape of
   * argument, and both shapes it is wrong for fail as a URL rather than as a request: a path declared
   * without its leading slash becomes `http://localhost:5001health`, and a base URL with a trailing one
   * becomes `http://localhost:5001//v1/x`. What the caller then reads is `Failed to parse URL from …`
   * naming a string nobody typed, which looks like a bad base URL or a service that is down.
   *
   * An empty path is the base URL itself, and stays that way: it is what the GraphQL provider asks for,
   * where the operation lives in the document rather than in a route.
   *
   * The ends are walked by index rather than trimmed with `/\/+$/` and `/^\/+/`. The patterns read
   * better and CodeQL is right to refuse them: an anchored `\/+` is polynomial against a string of
   * many slashes, and both halves here arrive from a config file or a command line, which is the
   * untrusted input that rule means. Two indices say everything the patterns did, in one pass.
   */
  url(path: string): string {
    if (path.startsWith("http")) return path;
    let end = this.baseUrl.length;
    while (end > 0 && this.baseUrl[end - 1] === "/") end -= 1;
    const base = this.baseUrl.slice(0, end);
    if (!path) return base;
    let start = 0;
    while (start < path.length && path[start] === "/") start += 1;
    return `${base}/${path.slice(start)}`;
  }

  async request<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
    const { body, headers, operation, ...rest } = init;
    const started = Date.now();
    const merged: Record<string, string> = {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(this.defaults() as Record<string, string>),
      ...(headers as Record<string, string> | undefined),
    };
    const res = await fetch(this.url(path), {
      ...rest,
      headers: merged,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();

    // Recorded whether it worked or not: a 400 with its body attached is the difference between fixing
    // a request and guessing at it. Credential values are not — that one was SENT is the useful part.
    this.trace?.add({
      kind: "http",
      operation,
      method: init.method ?? "GET",
      url: this.url(path),
      requestHeaders: Object.fromEntries(
        Object.keys(merged).map(k => [k, /key|auth|cookie|token/i.test(k) ? "«sent»" : merged[k]]),
      ),
      requestBody: Trace.clip(body),
      status: res.status,
      responseHeaders: (() => {
        const out: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          out[k] = v;
        });
        return out;
      })(),
      responseBody: Trace.clip(text),
      ms: Date.now() - started,
      error: res.ok ? undefined : String(res.status),
      at: new Date().toISOString(),
    });

    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    if (!text) return undefined as T;

    // Most of what an app answers is JSON, and none of it has to be: a readiness probe that says
    // `pong` is a working endpoint, and `Unexpected token 'p'` is a worse answer than `pong`.
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      if (/json/i.test(res.headers.get("content-type") ?? "")) {
        throw new Error(
          `${init.method ?? "GET"} ${path} → ${res.status} said it was JSON and was not: ` +
            `${String(err)} — body began ${text.slice(0, 120)}`,
          // The parse failure itself, kept: the message says what happened, the cause says where.
          { cause: err },
        );
      }
      return text as T;
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  /** The same API with extra headers — an api key, a session cookie, a tenant. */
  with(headers: Record<string, string> | (() => Record<string, string>)): HttpApi {
    const extra = typeof headers === "function" ? headers : () => headers;
    return new HttpApi(this.baseUrl, () => ({ ...(this.defaults() as Record<string, string>), ...extra() }));
  }
}

export type ApiInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** The named operation this request came from, so the trace can say so. */
  operation?: string;
};
