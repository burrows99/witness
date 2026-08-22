import { fill } from "../config/index.ts";
import { HttpApi } from "../http/client.ts";
import type { Stack } from "../environment/stack.ts";
import type { Trace } from "../diagnostics/trace.ts";
import { type AuthConfig, authHeaders } from "./auth.ts";
import { Registry } from "./registry.ts";

/**
 * How the system talks to one API.
 *
 * REST and GraphQL differ in exactly two ways — where the operation's identity lives (a path vs a
 * document) and how the answer is shaped — so they are two providers over the same client, not two
 * clients. A third (SOAP, gRPC-web, a queue) registers here and every operation, CLI verb and action
 * step keeps working unchanged.
 */
export type OperationConfig = {
  /** REST: the path, with `{param}` placeholders. */
  path?: string;
  method?: string;
  /** GraphQL: the document. `{param}` placeholders work here too. */
  query?: string;
  /** Which part of the answer to return, e.g. `tasks.data`, or `0` for the first item. */
  pick?: string;
  /**
   * Narrow an array answer.
   *
   * Third-party APIs routinely refuse to filter by the thing you care about — a task list that cannot be
   * asked for one patient's tasks — and that is how an adapter class gets written. Declaring the filter
   * keeps it in the one file that describes the integration.
   *
   * `{ "patient.id": "{patientId}" }` matches a nested field; a value may also be
   * `{ "startsWith": … }`, `{ "not": … }` or `{ "in": [ … ] }`.
   */
  where?: Record<string, unknown>;
  /** After `where`/`map`, take one more step into the result — `"0"` for the first item. */
  then?: string;
  /** Reshape each item: `{ "assignedTo": "assignedToUserName" }`, or `{ "clinicianId": "{clinicianId}" }`. */
  map?: Record<string, string>;
  /**
   * How to reverse this operation.
   *
   * The system records what each call created and `undoAll()` takes it back down. Third-party sandboxes
   * are shared: a booking or a rota row left behind silently removes that slot from somebody else's run,
   * and nobody debugging that would think to look here.
   */
  undo?: { operation: string; param: string; idPath?: string };
  /** Which of the client's named auth schemes to use. Omit for an unauthenticated route. */
  auth?: string;
  body?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  summary?: string;
};

export type ClientConfig = {
  provider?: string;
  service: string;
  auth?: Record<string, AuthConfig>;
  operations: Record<string, OperationConfig>;
  /** Refuse to run unless the resolved base URL matches — a guard for anything that deletes. */
  requireUrlMatch?: string;
};

export type ClientContext = {
  http: HttpApi;
  stack: Stack;
  trace: Trace;
  config: ClientConfig;
};

export type ClientProvider = {
  /** The URL an operation would hit, for a note or a browser. */
  url: (op: OperationConfig, params: Params, context: ClientContext) => string;
  call: <T>(name: string, op: OperationConfig, params: Params, body: unknown, context: ClientContext) => Promise<T>;
};

export type Params = Record<string, unknown>;

/** Follow a dotted path, with numeric segments indexing arrays. */
const at = (value: unknown, path: string): unknown => {
  let cursor = value;
  for (const key of path.split(".").filter(Boolean)) {
    cursor = Array.isArray(cursor) && /^\d+$/.test(key)
      ? cursor[Number(key)]
      : (cursor as Record<string, unknown> | undefined)?.[key];
  }
  return cursor;
};

const same = (left: unknown, right: unknown): boolean =>
  typeof left === "string" && typeof right === "string"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;

const matches = (item: unknown, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([path, expected]) => {
    const actual = at(item, path);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const rule = expected as Record<string, unknown>;
      if ("startsWith" in rule) return String(actual ?? "").startsWith(String(rule.startsWith));
      if ("not" in rule) return !same(actual, rule.not);
      if ("in" in rule) return (rule.in as unknown[]).some(v => same(actual, v));
    }
    return same(actual, expected);
  });

/** Narrow and reshape, as the operation declared. */
const shape = (answer: unknown, op: OperationConfig, params: Params): unknown => {
  let value = op.pick ? at(answer, op.pick) : answer;
  if (op.where && Array.isArray(value)) {
    const where = template(op.where, params) as Record<string, unknown>;
    value = value.filter(item => matches(item, where));
  }
  if (op.map && Array.isArray(value)) {
    value = value.map(item =>
      Object.fromEntries(
        Object.entries(op.map!).map(([to, from]) => [
          to,
          /^\{.*\}$/.test(from) ? template(from, params) : at(item, from),
        ]),
      ),
    );
  }
  if (op.then) value = at(value, op.then);
  return value;
};

const headersFor = async (op: OperationConfig, params: Params, context: ClientContext): Promise<Record<string, string>> => {
  if (!op.auth) return {};
  const scheme = context.config.auth?.[op.auth];
  if (!scheme) throw new Error(`operation wants auth "${op.auth}", which this client does not define`);
  return authHeaders(scheme, { stack: context.stack, params });
};

const template = (value: unknown, params: Params): unknown => {
  if (typeof value === "string") {
    const whole = value.match(/^\{(\w+)\}$/);
    if (whole && params[whole[1]] !== undefined) return params[whole[1]];
    return fill(value, params);
  }
  if (Array.isArray(value)) return value.map(v => template(v, params));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, template(v, params)]));
  }
  return value;
};

export const clientProviders = new Registry<ClientProvider>("client")
  .register("rest", {
    url: (op, params, context) => context.http.url(fill(op.path ?? "", params)),
    call: async (name, op, params, body, context) => {
      const templated = op.body ? (template(op.body, params) as Record<string, unknown>) : undefined;
      const merged =
        body !== undefined && templated !== undefined
          ? { ...templated, ...(body as Record<string, unknown>) }
          : (body ?? templated);
      const answer = await context.http.request(fill(op.path ?? "", params), {
        method: op.method ?? "GET",
        body: merged,
        headers: await headersFor(op, params, context),
        operation: name,
      });
      return shape(answer, op, params) as never;
    },
  })
  .register("graphql", {
    url: (_op, _params, context) => context.http.url(""),
    call: async (name, op, params, body, context) => {
      if (!op.query) throw new Error(`graphql operation "${name}" declares no query`);
      const variables = {
        ...((template(op.variables ?? {}, params) as Record<string, unknown>) ?? {}),
        ...((body as Record<string, unknown>) ?? {}),
      };
      const answer = await context.http.request<{ data?: unknown; errors?: { message: string }[] }>("", {
        method: "POST",
        body: { query: fill(op.query, params), variables },
        headers: await headersFor(op, params, context),
        operation: name,
      });
      if (answer.errors?.length) throw new Error(`${name}: ${answer.errors.map(e => e.message).join("; ")}`);
      return shape(answer.data, op, params) as never;
    },
  });
