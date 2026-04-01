import { CliConfig } from "./config.js";
import { EntityName } from "./entities.js";

export interface ApiMeta {
  count?: number;
  db_response_time_ms?: number;
  page?: number;
  per_page?: number;
  next_cursor?: string | null;
  groups_count?: number;
}

export interface RateLimitMeta {
  limit?: number;
  remaining?: number;
  reset?: number;
  creditsUsed?: number;
}

export interface ApiEnvelope<T> {
  meta?: ApiMeta;
  results?: T[];
  group_by?: Array<Record<string, unknown>>;
  data?: T;
  rateLimit: RateLimitMeta;
  requestUrl: string;
}

export interface ListOptions {
  filter?: string[];
  search?: string;
  sort?: string;
  select?: string[];
  sample?: number;
  seed?: string;
  page?: number;
  perPage?: number;
  cursor?: string;
  includeXpac?: boolean;
}

export class OpenAlexClient {
  public constructor(private readonly config: CliConfig) {}

  public async getRateLimit(): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("/rate-limit", this.createQuery({}), false);
  }

  public async get(entity: EntityName, id: string, select?: string[]): Promise<ApiEnvelope<Record<string, unknown>>> {
    const query = this.createQuery({ select });
    const path = `/${entity}/${encodeURIComponent(id)}`;
    return this.request<Record<string, unknown>>(path, query, false);
  }

  public async random(entity: EntityName, select?: string[]): Promise<ApiEnvelope<Record<string, unknown>>> {
    const query = this.createQuery({ select });
    return this.request<Record<string, unknown>>(`/${entity}/random`, query, false);
  }

  public async autocomplete(entity: EntityName, queryText: string): Promise<ApiEnvelope<Record<string, unknown>>> {
    const query = this.createQuery({ q: queryText });
    return this.request<Record<string, unknown>>(`/autocomplete/${entity}`, query, true);
  }

  public async list(entity: EntityName, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const query = this.createQuery({
      filter: joinMulti(options.filter),
      search: options.search,
      sort: options.sort,
      select: joinMulti(options.select),
      sample: numberToString(options.sample),
      seed: options.seed,
      page: numberToString(options.page),
      per_page: numberToString(options.perPage),
      cursor: options.cursor,
      include_xpac: options.includeXpac ? "true" : undefined,
    });

    return this.request<Record<string, unknown>>(`/${entity}`, query, true);
  }

  public async group(entity: EntityName, groupBy: string, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const query = this.createQuery({
      group_by: groupBy,
      filter: joinMulti(options.filter),
      search: options.search,
      sort: options.sort,
      sample: numberToString(options.sample),
      seed: options.seed,
      page: numberToString(options.page),
      per_page: numberToString(options.perPage),
      cursor: options.cursor,
      include_xpac: options.includeXpac ? "true" : undefined,
    });

    return this.request<Record<string, unknown>>(`/${entity}`, query, true);
  }

  public async listFromUrl(url: string, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const absoluteUrl = new URL(url);

    applyListOptionsToSearchParams(absoluteUrl.searchParams, options);
    return this.requestAbsolute<Record<string, unknown>>(absoluteUrl.toString(), true);
  }

  public async getRelatedWorks(workId: string, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const work = await this.get("works", workId);
    const relatedWorks = ((work.data?.related_works as string[] | undefined) ?? []).slice(0, 50);
    const ids = relatedWorks.map((item) => item.replace("https://openalex.org/", ""));

    if (ids.length === 0) {
      return {
        rateLimit: work.rateLimit,
        requestUrl: work.requestUrl,
        meta: { count: 0, page: 1, per_page: 0 },
        results: [],
      };
    }

    return this.list("works", {
      ...options,
      filter: appendFilter(options.filter, `openalex:${ids.join("|")}`),
      perPage: Math.min(options.perPage ?? ids.length, ids.length),
    });
  }

  public async getCitedByWorks(workId: string, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const work = await this.get("works", workId);
    const openAlexId = extractShortOpenAlexId(work.data?.id);
    if (!openAlexId) {
      throw new Error(`Unable to resolve OpenAlex work id for: ${workId}`);
    }

    return this.list("works", {
      ...options,
      filter: appendFilter(options.filter, `cites:${openAlexId}`),
    });
  }

  public async getReferencedWorks(workId: string, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const work = await this.get("works", workId);
    const openAlexId = extractShortOpenAlexId(work.data?.id);
    if (!openAlexId) {
      throw new Error(`Unable to resolve OpenAlex work id for: ${workId}`);
    }

    return this.list("works", {
      ...options,
      filter: appendFilter(options.filter, `cited_by:${openAlexId}`),
    });
  }

  private async request<T>(path: string, query: URLSearchParams, expectsList: boolean): Promise<ApiEnvelope<T>> {
    if (this.config.apiKey && !query.has("api_key")) {
      query.set("api_key", this.config.apiKey);
    }

    if (this.config.mailto && !query.has("mailto")) {
      query.set("mailto", this.config.mailto);
    }

    const url = new URL(path, this.config.baseUrl);
    url.search = query.toString();
    return this.performRequest<T>(url, expectsList);
  }

  private async requestAbsolute<T>(rawUrl: string, expectsList: boolean): Promise<ApiEnvelope<T>> {
    const url = new URL(rawUrl);

    if (this.config.apiKey && !url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", this.config.apiKey);
    }

    if (this.config.mailto && !url.searchParams.has("mailto")) {
      url.searchParams.set("mailto", this.config.mailto);
    }

    return this.performRequest<T>(url, expectsList);
  }

  private async performRequest<T>(url: URL, expectsList: boolean): Promise<ApiEnvelope<T>> {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "openalex-skill/0.1.1",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatOpenAlexError(url, response.status, response.statusText, body));
    }

    const json = (await response.json()) as Record<string, unknown>;
    const envelope: ApiEnvelope<T> = {
      rateLimit: readRateLimit(response.headers),
      requestUrl: url.toString(),
    };

    if (expectsList) {
      envelope.meta = json.meta as ApiMeta | undefined;
      envelope.results = (json.results as T[] | undefined) ?? [];
      if (Array.isArray(json.group_by)) {
        envelope.group_by = json.group_by as Array<Record<string, unknown>>;
      }
      return envelope;
    }

    envelope.data = json as T;
    return envelope;
  }

  private createQuery(values: Record<string, string | string[] | undefined>): URLSearchParams {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          query.set(key, value.join(","));
        }
        continue;
      }

      if (value !== undefined && value !== "") {
        query.set(key, value);
      }
    }
    return query;
  }
}

function formatOpenAlexError(url: URL, status: number, statusText: string, body: string): string {
  const renderedBody = renderErrorBody(body);
  const baseMessage = renderedBody
    ? `OpenAlex request failed (${status} ${statusText}): ${renderedBody}`
    : `OpenAlex request failed (${status} ${statusText})`;
  if (status !== 404) {
    return baseMessage;
  }

  const resourceHint = readMissingResourceHint(url);
  return resourceHint ? `${baseMessage}\nHint: ${resourceHint}` : baseMessage;
}

function readMissingResourceHint(url: URL): string | undefined {
  const path = url.pathname;
  if (!/^\/works\/(?:W\d+|w\d+|doi:|https%3A%2F%2F|http%3A%2F%2F|pmid:|pmcid:)/.test(path)) {
    return undefined;
  }

  return "the work id or DOI may not exist in OpenAlex. If you were about to use `related`, `cited-by`, or `references`, verify it first with `openalex works get <id-or-doi>`.";
}

function renderErrorBody(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }

  if (looksLikeHtml(trimmed)) {
    return "upstream server returned an HTML error page";
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return readJsonErrorMessage(parsed) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function looksLikeHtml(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.startsWith("<!doctype") || lower.startsWith("<html") || lower.includes("<body");
}

function readJsonErrorMessage(value: Record<string, unknown>): string | undefined {
  const direct = [value.message, value.error, value.detail].find((item) => typeof item === "string");
  if (typeof direct === "string") {
    return direct;
  }

  return undefined;
}

function numberToString(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function joinMulti(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return values.join(",");
}

function readRateLimit(headers: Headers): RateLimitMeta {
  return {
    limit: parseOptionalNumber(headers.get("x-ratelimit-limit")),
    remaining: parseOptionalNumber(headers.get("x-ratelimit-remaining")),
    reset: parseOptionalNumber(headers.get("x-ratelimit-reset")),
    creditsUsed: parseOptionalNumber(headers.get("x-ratelimit-credits-used")),
  };
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyListOptionsToSearchParams(searchParams: URLSearchParams, options: ListOptions): void {
  const mappings: Array<[string, string | undefined]> = [
    ["filter", joinMulti(options.filter)],
    ["search", options.search],
    ["sort", options.sort],
    ["select", joinMulti(options.select)],
    ["sample", numberToString(options.sample)],
    ["seed", options.seed],
    ["page", numberToString(options.page)],
    ["per_page", numberToString(options.perPage)],
    ["cursor", options.cursor],
    ["include_xpac", options.includeXpac ? "true" : undefined],
  ];

  for (const [key, value] of mappings) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, value);
    }
  }
}

function appendFilter(existing: string[] | undefined, next: string): string[] {
  return [...(existing ?? []), next];
}

function extractShortOpenAlexId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.replace("https://openalex.org/", "");
}
