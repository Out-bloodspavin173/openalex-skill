import { CliConfig } from "./config.js";
import { EntityName } from "./entities.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

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
  all?: boolean;
  includeXpac?: boolean;
}

export class OpenAlexClient {
  public constructor(private readonly config: CliConfig) {}

  public authorizeDownloadUrl(rawUrl: string): string {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return rawUrl;
    }

    if (!/^content\.openalex\.org$/i.test(url.hostname)) {
      return rawUrl;
    }

    if (this.config.apiKey && !url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", this.config.apiKey);
    }

    if (this.config.mailto && !url.searchParams.has("mailto")) {
      url.searchParams.set("mailto", this.config.mailto);
    }

    return url.toString();
  }

  public async getRateLimit(): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("/rate-limit", this.createQuery({}), false);
  }

  public async get(entity: EntityName, id: string, select?: string[]): Promise<ApiEnvelope<Record<string, unknown>>> {
    const query = this.createQuery({ select });
    const path = `/${entity}/${encodeURIComponent(entity === "works" ? normalizeWorkIdentifier(id) : id)}`;
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
    if (options.all) {
      return this.requestAllListPages<Record<string, unknown>>(`/${entity}`, options);
    }

    const query = this.createListQuery(options);
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

    if (options.all) {
      if (options.page !== undefined) {
        throw new Error("Use cursor pagination for --all group requests.");
      }

      return this.requestAllGroupPages<Record<string, unknown>>(`/${entity}`, query, options.perPage);
    }

    return this.request<Record<string, unknown>>(`/${entity}`, query, true);
  }

  public async listFromUrl(url: string, options: ListOptions = {}): Promise<ApiEnvelope<Record<string, unknown>>> {
    const absoluteUrl = new URL(url);

    if (options.all) {
      if (options.page !== undefined) {
        throw new Error("Use cursor pagination for --all URL requests.");
      }

      applyListOptionsToSearchParams(absoluteUrl.searchParams, { ...options, cursor: options.cursor ?? "*" });
      return this.requestAllPagesFromUrl<Record<string, unknown>>(absoluteUrl, options.perPage, "results");
    }

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
    let response: Response | undefined;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "openalex-skill/0.1.2",
        },
      });

      if (response.ok) {
        break;
      }

      if (!shouldRetry(response.status) || attempt === MAX_RETRY_ATTEMPTS - 1) {
        const body = await response.text();
        throw new Error(formatOpenAlexError(url, response.status, response.statusText, body));
      }

      await sleep(resolveRetryDelayMs(response.headers, attempt));
    }

    if (!response || !response.ok) {
      throw new Error(`OpenAlex request failed before receiving a valid response: ${url.toString()}`);
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

  private createListQuery(options: ListOptions): URLSearchParams {
    return this.createQuery({
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
  }

  private async requestAllListPages<T>(path: string, options: ListOptions): Promise<ApiEnvelope<T>> {
    if (options.page !== undefined) {
      throw new Error("Use cursor pagination for --all requests.");
    }

    const query = this.createListQuery({ ...options, cursor: options.cursor ?? "*" });
    return this.requestAllPages<T>(path, query, options.perPage, "results");
  }

  private async requestAllGroupPages<T>(path: string, query: URLSearchParams, perPage: number | undefined): Promise<ApiEnvelope<T>> {
    if (!query.has("cursor")) {
      query.set("cursor", "*");
    }

    return this.requestAllPages<T>(path, query, perPage, "group_by");
  }

  private async requestAllPagesFromUrl<T>(url: URL, perPage: number | undefined, mode: "results" | "group_by"): Promise<ApiEnvelope<T>> {
    return this.requestAllPages<T>(url, undefined, perPage, mode);
  }

  private async requestAllPages<T>(
    pathOrUrl: string | URL,
    initialQuery: URLSearchParams | undefined,
    perPage: number | undefined,
    mode: "results" | "group_by",
  ): Promise<ApiEnvelope<T>> {
    let cursor = initialQuery?.get("cursor") ?? "*";
    let requestUrl = "";
    let rateLimit: RateLimitMeta = {};
    let meta: ApiMeta | undefined;
    const results: T[] = [];
    const groups: Array<Record<string, unknown>> = [];

    while (cursor) {
      const query = initialQuery ? new URLSearchParams(initialQuery) : new URL(pathOrUrl.toString()).searchParams;
      query.set("cursor", cursor);
      if (perPage !== undefined) {
        query.set("per_page", String(perPage));
      }

      const envelope = typeof pathOrUrl === "string"
        ? await this.request<T>(pathOrUrl, query, true)
        : await this.requestAbsolute<T>(buildAbsoluteUrl(pathOrUrl, query), true);

      requestUrl ||= envelope.requestUrl;
      rateLimit = envelope.rateLimit;
      meta ??= envelope.meta;

      if (mode === "results") {
        results.push(...(envelope.results ?? []));
      } else {
        groups.push(...(envelope.group_by ?? []));
      }

      cursor = envelope.meta?.next_cursor ?? "";
    }

    return {
      requestUrl,
      rateLimit,
      meta: meta ? { ...meta, per_page: perPage ?? meta.per_page, next_cursor: null } : undefined,
      results: mode === "results" ? results : undefined,
      group_by: mode === "group_by" ? groups : undefined,
    };
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

function shouldRetry(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function resolveRetryDelayMs(headers: Headers, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(0, seconds * 1000);
    }

    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }

  return RETRY_BASE_DELAY_MS * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAbsoluteUrl(url: URL, searchParams: URLSearchParams): string {
  const nextUrl = new URL(url.toString());
  nextUrl.search = searchParams.toString();
  return nextUrl.toString();
}

function appendFilter(existing: string[] | undefined, next: string): string[] {
  return [...(existing ?? []), next];
}

export function normalizeWorkIdentifier(id: string): string {
  const trimmed = id.trim();
  const bareDoiMatch = trimmed.match(/^10\.\d{4,9}\/\S+$/i);
  if (bareDoiMatch) {
    return `https://doi.org/${bareDoiMatch[0]}`;
  }

  const doiUrlMatch = trimmed.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i);
  if (doiUrlMatch) {
    return `https://doi.org/${doiUrlMatch[1]}`;
  }

  const doiPrefixedMatch = trimmed.match(/^doi:\s*(10\.\d{4,9}\/\S+)$/i);
  if (doiPrefixedMatch) {
    return `https://doi.org/${doiPrefixedMatch[1]}`;
  }

  return trimmed;
}

function extractShortOpenAlexId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const matched = value.match(/^https?:\/\/openalex\.org\/([A-Z]\d+)$/i);
  return matched?.[1]?.toUpperCase();
}
