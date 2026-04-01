import pc from "picocolors";

import type { EntityName } from "./entities.js";

export type OutputFormat = "auto" | "summary" | "detail" | "json" | "jsonl" | "markdown";

export interface RenderContext {
  format: OutputFormat;
  title: string;
  fields?: string[];
  entity?: EntityName | "rate-limit";
}

export function resolveOutputFormat(format: OutputFormat): Exclude<OutputFormat, "auto"> {
  if (format !== "auto") {
    return format;
  }

  return "summary";
}

export function renderEnvelope(ctx: RenderContext, payload: unknown): string {
  const format = resolveOutputFormat(ctx.format);
  const projectedPayload = projectPayload(payload, ctx.fields ?? []);
  const safePayload = redactSensitivePayload(projectedPayload);
  const detailPayload = ctx.fields && ctx.fields.length > 0 ? compactProjectedValue(safePayload) : safePayload;

  switch (format) {
    case "detail":
      return renderDetail(ctx.title, detailPayload);
    case "json":
      return `${JSON.stringify(safePayload, null, 2)}\n`;
    case "jsonl":
      return renderJsonl(safePayload);
    case "markdown":
      return renderMarkdown(ctx.title, safePayload);
    case "summary":
    default:
      return renderSummary(ctx.title, safePayload, ctx.entity);
  }
}

function renderJsonl(payload: unknown): string {
  if (Array.isArray(payload)) {
    return `${payload.map((item) => JSON.stringify(item)).join("\n")}\n`;
  }

  const objectPayload = payload as Record<string, unknown>;
  if (Array.isArray(objectPayload.group_by) && objectPayload.group_by.length > 0) {
    return `${objectPayload.group_by.map((item) => JSON.stringify(item)).join("\n")}\n`;
  }

  if (Array.isArray(objectPayload.results)) {
    return `${objectPayload.results.map((item) => JSON.stringify(item)).join("\n")}\n`;
  }

  if (objectPayload.data !== undefined) {
    return `${JSON.stringify(objectPayload.data)}\n`;
  }

  return `${JSON.stringify(payload)}\n`;
}

function renderMarkdown(title: string, payload: unknown): string {
  const lines = [`# ${title}`, "", "```json", JSON.stringify(payload, null, 2), "```", ""];
  return lines.join("\n");
}

function renderDetail(title: string, payload: unknown): string {
  const lines = [pc.bold(title)];

  if (Array.isArray(payload)) {
    lines.push(...renderDetailedValue(normalizeDetailValue(payload), 0));
    return `${lines.join("\n")}\n`;
  }

  const objectPayload = payload as Record<string, unknown>;
  if (Array.isArray(objectPayload.group_by) && objectPayload.group_by.length > 0) {
    const meta = objectPayload.meta as Record<string, unknown> | undefined;
    if (meta) {
      lines.push(renderMetaLine(meta));
    }
    lines.push(...renderDetailedValue(normalizeDetailValue(objectPayload.group_by), 0, "groups"));
    return `${lines.join("\n")}\n`;
  }

  if (Array.isArray(objectPayload.results)) {
    const meta = objectPayload.meta as Record<string, unknown> | undefined;
    if (meta) {
      lines.push(renderMetaLine(meta));
    }
    (objectPayload.results as unknown[]).forEach((item, index) => {
      lines.push(pc.dim(`[${index + 1}]`));
      lines.push(...renderDetailedValue(normalizeDetailValue(item), 1));
    });
    return `${lines.join("\n")}\n`;
  }

  lines.push(...renderDetailedValue(normalizeDetailValue(getBusinessPayload(objectPayload)), 0));
  return `${lines.join("\n")}\n`;
}

function renderSummary(title: string, payload: unknown, entity?: EntityName | "rate-limit"): string {
  const lines: string[] = [];
  lines.push(pc.bold(title));

  if (Array.isArray(payload)) {
    lines.push(...renderList(payload, entity));
    return `${lines.join("\n")}\n`;
  }

  const objectPayload = payload as Record<string, unknown>;
  if (Array.isArray(objectPayload.group_by) && objectPayload.group_by.length > 0) {
    const meta = objectPayload.meta as Record<string, unknown> | undefined;
    if (meta) {
      lines.push(renderMetaLine(meta));
    }
    const groupRows = objectPayload.group_by as Array<Record<string, unknown>>;
    lines.push(...groupRows.map((row) => summarizeGroup(row)));
    return `${lines.join("\n")}\n`;
  }

  if (Array.isArray(objectPayload.results)) {
    const meta = objectPayload.meta as Record<string, unknown> | undefined;
    if (meta) {
      lines.push(renderMetaLine(meta));
    }
    lines.push(...renderList(objectPayload.results as unknown[], entity));
    return `${lines.join("\n")}\n`;
  }

  const data = (objectPayload.data ?? objectPayload) as Record<string, unknown>;
  if (isRateLimitPayload(data)) {
    lines.push(...renderRateLimitSummary(data));
  } else {
    lines.push(...renderObject(data, entity));
  }
  return `${lines.join("\n")}\n`;
}

function renderMetaLine(meta: Record<string, unknown>): string {
  const parts = [
    meta.count !== undefined ? `count=${String(meta.count)}` : undefined,
    meta.page !== undefined ? `page=${String(meta.page)}` : undefined,
    meta.per_page !== undefined ? `per_page=${String(meta.per_page)}` : undefined,
    meta.next_cursor !== undefined && meta.next_cursor !== null ? `next_cursor=${String(meta.next_cursor)}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? pc.dim(parts.join("  ")) : "";
}

function renderList(items: unknown[], entity?: EntityName | "rate-limit"): string[] {
  if (items.length === 0) {
    return [pc.dim("No results.")];
  }

  return items.flatMap((item, index) => summarizeItemLines(item as Record<string, unknown>, index, entity));
}

function renderObject(item: Record<string, unknown>, entity?: EntityName | "rate-limit"): string[] {
  return summarizeItemLines(item, 0, entity);
}

function summarizeItem(item: Record<string, unknown>, index: number): string {
  const title =
    cleanSummaryText((item.display_name as string | undefined) ??
    (item.title as string | undefined) ??
    (item.id as string | undefined)) ??
    `Result ${index + 1}`;

  const secondary = [
    item.publication_year,
    item.type,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    extractPrimaryAuthor(item),
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => String(value));

  if (secondary.length === 0) {
    return `- ${title}`;
  }

  return `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}`;
}

function summarizeItemLines(
  item: Record<string, unknown>,
  index: number,
  entity?: EntityName | "rate-limit",
): string[] {
  switch (entity) {
    case "works":
      return summarizeWorkLines(item, index);
    case "authors":
      return summarizeAuthorLines(item, index);
    case "institutions":
      return summarizeInstitutionLines(item, index);
    case "sources":
      return summarizeSourceLines(item, index);
    case "topics":
      return summarizeTopicLines(item, index);
    case "publishers":
      return summarizePublisherLines(item, index);
    case "funders":
      return summarizeFunderLines(item, index);
    case "concepts":
      return summarizeConceptLines(item, index);
    default:
      return [summarizeItem(item, index)];
  }
}

function summarizeWorkLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.title ?? item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const workType = typeof item.type === "string" && item.type !== "article" ? item.type : undefined;
  const secondary = [
    item.publication_year,
    workType,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    readWorkOaStatus(item),
    cleanSummaryText(readNestedString(item, ["primary_location", "source", "display_name"]))?.replace(/^Proceedings of /, ""),
    cleanSummaryText(readNestedString(item, ["primary_topic", "display_name"])),
  ]
    .filter(Boolean)
    .map(String);

  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const authors = summarizeAuthors(item.authorships);
  const preferredDoi = readPreferredWorkDoi(item);
  const alternateDoi = readAlternateWorkDoi(item, preferredDoi);
  const identifierLine = formatSummaryIdentifierLine([
    ["id", shortId !== title ? shortId : undefined],
    ["authors", authors],
    ["doi", preferredDoi],
    ["record doi", alternateDoi],
  ]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function readPreferredWorkDoi(item: Record<string, unknown>): string | undefined {
  const idsDoi = readNestedString(item, ["ids", "doi"]);
  if (idsDoi) {
    return idsDoi;
  }

  return typeof item.doi === "string" ? item.doi : undefined;
}

function readAlternateWorkDoi(item: Record<string, unknown>, preferredDoi: string | undefined): string | undefined {
  if (typeof item.doi !== "string") {
    return undefined;
  }

  return normalizeDoiForComparison(item.doi) !== normalizeDoiForComparison(preferredDoi) ? item.doi : undefined;
}

function normalizeDoiForComparison(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.trim().replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
}

function summarizeAuthorLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const hIndex = readNestedNumber(item, ["summary_stats", "h_index"]);
  const secondary = [
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    hIndex !== undefined ? `h-index ${String(hIndex)}` : undefined,
    cleanSummaryText(readNestedStringFromArray(item, ["last_known_institutions"], ["display_name"])),
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([
    ["id", shortId !== title ? shortId : undefined],
    ["orcid", typeof item.orcid === "string" ? item.orcid : undefined],
  ]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function summarizeInstitutionLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const hIndex = readNestedNumber(item, ["summary_stats", "h_index"]);
  const secondary = [
    typeof item.country_code === "string" ? item.country_code : undefined,
    typeof item.type === "string" ? item.type : undefined,
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    hIndex !== undefined ? `h-index ${String(hIndex)}` : undefined,
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([
    ["id", shortId !== title ? shortId : undefined],
    ["ror", typeof item.ror === "string" ? item.ror : undefined],
  ]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function summarizeSourceLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const meanCitedness = readNestedNumber(item, ["summary_stats", "2yr_mean_citedness"]);
  const secondary = [
    typeof item.issn_l === "string" ? `ISSN ${item.issn_l}` : undefined,
    typeof item.type === "string" ? item.type : undefined,
    readSourceOa(item),
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    meanCitedness !== undefined ? `2yr ${String(meanCitedness)}` : undefined,
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([["id", shortId !== title ? shortId : undefined]]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function summarizeTopicLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const taxonomy = [
    cleanSummaryText(readNestedString(item, ["field", "display_name"])),
    cleanSummaryText(readNestedString(item, ["subfield", "display_name"])),
    cleanSummaryText(readNestedString(item, ["domain", "display_name"])),
  ].filter(Boolean);
  const secondary = [
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    typeof item.level === "number" ? `level ${String(item.level)}` : undefined,
    taxonomy.length > 0 ? taxonomy.join(" > ") : undefined,
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([["id", shortId !== title ? shortId : undefined]]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function summarizePublisherLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const secondary = [
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    item.hierarchy_level !== undefined ? `level ${String(item.hierarchy_level)}` : undefined,
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([["id", shortId !== title ? shortId : undefined]]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function summarizeFunderLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const hIndex = readNestedNumber(item, ["summary_stats", "h_index"]);
  const secondary = [
    typeof item.country_code === "string" ? item.country_code : undefined,
    item.grants_count !== undefined ? `grants ${String(item.grants_count)}` : undefined,
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    item.cited_by_count !== undefined ? `cited ${String(item.cited_by_count)}` : undefined,
    hIndex !== undefined ? `h-index ${String(hIndex)}` : undefined,
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([["id", shortId !== title ? shortId : undefined]]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function summarizeConceptLines(item: Record<string, unknown>, index: number): string[] {
  const shortId = readOpenAlexIdentifier(item.id);
  const title = cleanSummaryText(String(item.display_name ?? shortId ?? item.id ?? `Result ${index + 1}`));
  const ancestors = readNestedNames(item.ancestors).map((item) => cleanSummaryText(item)).slice(0, 3);
  const secondary = [
    typeof item.level === "number" ? `level ${String(item.level)}` : undefined,
    item.works_count !== undefined ? `works ${String(item.works_count)}` : undefined,
    ancestors.length > 0 ? ancestors.join(" > ") : undefined,
  ]
    .filter(Boolean)
    .map(String);
  const lines = [secondary.length > 0 ? `- ${title} ${pc.dim(`(${secondary.join(" | ")})`)}` : `- ${title}`];
  const identifierLine = formatSummaryIdentifierLine([["id", shortId !== title ? shortId : undefined]]);
  if (identifierLine) {
    lines.push(identifierLine);
  }
  return lines;
}

function formatSummaryIdentifierLine(parts: Array<[label: string, value: string | undefined]>): string | undefined {
  const visible = parts
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([label, value]) => `${label}: ${value}`);

  if (visible.length === 0) {
    return undefined;
  }

  return `  ${pc.dim(visible.join("  |  "))}`;
}

function readOpenAlexIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const matched = value.match(/^https?:\/\/openalex\.org\/([A-Z]\d+)$/i);
  return matched?.[1]?.toUpperCase();
}

function readWorkOaStatus(item: Record<string, unknown>): string | undefined {
  const status = readNestedString(item, ["open_access", "oa_status"]);
  if (status) {
    return `OA ${status}`;
  }

  const isOa = readNestedBoolean(item, ["open_access", "is_oa"]);
  return isOa === true ? "OA" : undefined;
}

function readSourceOa(item: Record<string, unknown>): string | undefined {
  const isOa = typeof item.is_oa === "boolean" ? item.is_oa : undefined;
  const inDoaj = typeof item.is_in_doaj === "boolean" ? item.is_in_doaj : undefined;
  if (isOa && inDoaj) {
    return "OA DOAJ";
  }
  if (isOa) {
    return "OA";
  }
  return undefined;
}

function summarizeAuthors(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const names = value
    .map((item) => cleanSummaryText(readNestedString(item, ["author", "display_name"])))
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    return undefined;
  }

  const visible = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${visible} + ${names.length - 3} more` : visible;
}

function cleanSummaryText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/<\/?[^>]+>/g, "").trim() || undefined;
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  const nested = readNested(value, path);
  return typeof nested === "string" && nested !== "" ? nested : undefined;
}

function readNestedNumber(value: unknown, path: string[]): number | undefined {
  const nested = readNested(value, path);
  return typeof nested === "number" ? nested : undefined;
}

function readNestedBoolean(value: unknown, path: string[]): boolean | undefined {
  const nested = readNested(value, path);
  return typeof nested === "boolean" ? nested : undefined;
}

function readNestedStringFromArray(value: unknown, arrayPath: string[], childPath: string[]): string | undefined {
  const arrayValue = readNested(value, arrayPath);
  if (!Array.isArray(arrayValue) || arrayValue.length === 0) {
    return undefined;
  }
  return readNestedString(arrayValue[0], childPath);
}

function readNestedNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readNestedString(item, ["display_name"])).filter((item): item is string => Boolean(item));
}

function readNested(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function extractPrimaryAuthor(item: Record<string, unknown>): string | undefined {
  const authorships = item.authorships;
  if (!Array.isArray(authorships) || authorships.length === 0) {
    return undefined;
  }

  const first = authorships[0] as Record<string, unknown>;
  const author = first.author as Record<string, unknown> | undefined;
  return author?.display_name as string | undefined;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function renderDetailedValue(value: unknown, depth: number, key?: string): string[] {
  const indent = "  ".repeat(depth);
  const label = key ? `${key}: ` : "";

  if (value === null || value === undefined) {
    return [`${indent}${label}${pc.dim("null")}`];
  }

  if (Array.isArray(value)) {
    if (key && canInlineScalarArray(value)) {
      return [`${indent}${label}${value.map((item) => stringifyScalar(item)).join(", ")}`];
    }

    if (value.length === 0) {
      return [`${indent}${label}${pc.dim("[]")}`];
    }

    const lines = [`${indent}${label}${pc.dim(`[${value.length} items]`)}`];
    value.forEach((item, index) => {
      const itemKey = isRecord(item) || Array.isArray(item) ? `[${index + 1}]` : "-";
      lines.push(...renderDetailedValue(item, depth + 1, itemKey));
    });

    return lines;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${indent}${label}${pc.dim("{}")}`];
    }

    const lines = key ? [`${indent}${key}:`] : [];
    for (const [childKey, childValue] of entries) {
      lines.push(...renderDetailedValue(childValue, depth + (key ? 1 : 0), childKey));
    }

    return lines;
  }

  return [`${indent}${label}${stringifyScalar(value)}`];
}

function stringifyScalar(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function canInlineScalarArray(value: unknown[]): boolean {
  if (value.length === 0 || value.length > 12) {
    return false;
  }

  if (!value.every((item) => isScalar(item))) {
    return false;
  }

  return value.map((item) => stringifyScalar(item)).join(", ").length <= 160;
}

function projectPayload(payload: unknown, fields: string[]): unknown {
  if (fields.length === 0) {
    return payload;
  }

  if (!isRecord(payload)) {
    return pickFields(payload, fields);
  }

  if (Array.isArray(payload.results) || Array.isArray(payload.group_by) || payload.data !== undefined) {
    return {
      ...payload,
      data: payload.data !== undefined ? pickFields(payload.data, fields) : payload.data,
      results: Array.isArray(payload.results) ? payload.results.map((item) => pickFields(item, fields)) : payload.results,
      group_by: Array.isArray(payload.group_by) ? payload.group_by.map((item) => pickFields(item, fields)) : payload.group_by,
    };
  }

  return pickFields(payload, fields);
}

function pickFields(value: unknown, fields: string[]): unknown {
  if (fields.length === 0) {
    return cloneValue(value);
  }

  let projected: unknown = undefined;
  for (const field of fields) {
    const partial = projectPath(value, field.split(".").filter(Boolean));
    if (partial !== undefined) {
      projected = mergeProjected(projected, partial);
    }
  }

  return projected ?? {};
}

function projectPath(value: unknown, path: string[]): unknown {
  if (path.length === 0) {
    return cloneValue(value);
  }

  if (Array.isArray(value)) {
    const projectedItems = value.map((item) => projectPath(item, path));
    return projectedItems.some((item) => item !== undefined) ? projectedItems : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const [head, ...rest] = path;
  if (!(head in value)) {
    if (head === "abstract" && rest.length === 0) {
      const abstract = readProjectedAbstract(value);
      return abstract === undefined ? undefined : { abstract };
    }

    return undefined;
  }

  const child = rest.length === 0 ? cloneValue(value[head]) : projectPath(value[head], rest);
  if (child === undefined) {
    return undefined;
  }

  return { [head]: child };
}

function mergeProjected(base: unknown, next: unknown): unknown {
  if (base === undefined) {
    return cloneValue(next);
  }

  if (next === undefined) {
    return cloneValue(base);
  }

  if (Array.isArray(base) && Array.isArray(next)) {
    const length = Math.max(base.length, next.length);
    const merged = Array.from({ length }, (_, index) => mergeProjected(base[index], next[index]));
    return merged.some((item) => item !== undefined) ? merged : undefined;
  }

  if (isRecord(base) && isRecord(next)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(next)) {
      merged[key] = mergeProjected(merged[key], value);
    }
    return merged;
  }

  return cloneValue(next);
}

function compactProjectedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => compactProjectedValue(item));
    const compacted = compactUniformObjectArray(items);
    return compacted ?? items;
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactProjectedValue(item)]));
}

function compactUniformObjectArray(items: unknown[]): unknown | undefined {
  if (items.length === 0 || !items.every((item) => isRecord(item))) {
    return undefined;
  }

  const keys = Object.keys(items[0]);
  if (keys.length !== 1) {
    return undefined;
  }

  const [sharedKey] = keys;
  if (!items.every((item) => Object.keys(item).length === 1 && sharedKey in item)) {
    return undefined;
  }

  const sharedValues = items.map((item) => (item as Record<string, unknown>)[sharedKey]);
  if (sharedValues.every((item) => isScalar(item))) {
    return { [sharedKey]: sharedValues };
  }

  const nested = compactUniformObjectArray(sharedValues.map((item) => compactProjectedValue(item)));
  return nested === undefined ? undefined : { [sharedKey]: nested };
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }

  return value;
}

function readProjectedAbstract(value: Record<string, unknown>): string | undefined {
  if (typeof value.abstract === "string") {
    return value.abstract;
  }

  if (isRecord(value.abstract_inverted_index)) {
    return invertAbstractIndex(value.abstract_inverted_index);
  }

  return undefined;
}

function normalizeDetailValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDetailValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (key === "rateLimit" || key === "requestUrl") {
      continue;
    }

    if (key === "abstract_inverted_index" && isRecord(entryValue)) {
      if (normalized.abstract === undefined) {
        normalized.abstract = invertAbstractIndex(entryValue);
      }
      continue;
    }

    normalized[key] = normalizeDetailValue(entryValue);
  }

  return normalized;
}

function getBusinessPayload(payload: Record<string, unknown>): unknown {
  if (payload.data !== undefined) {
    return payload.data;
  }

  if (payload.results !== undefined) {
    return payload.results;
  }

  if (payload.group_by !== undefined) {
    return payload.group_by;
  }

  return payload;
}

function invertAbstractIndex(index: Record<string, unknown>): string {
  const positionedTerms: Array<[number, string]> = [];
  for (const [term, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) {
      continue;
    }

    for (const position of positions) {
      if (typeof position === "number") {
        positionedTerms.push([position, term]);
      }
    }
  }

  return positionedTerms.sort((left, right) => left[0] - right[0]).map(([, term]) => term).join(" ");
}

function redactSensitivePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitivePayload(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (key === "requestUrl" && typeof entryValue === "string") {
        return [key, redactUrl(entryValue)];
      }

      return [key, redactSensitivePayload(entryValue)];
    }),
  );
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", maskSecret(url.searchParams.get("api_key") ?? ""));
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function maskSecret(value: string): string {
  if (value.length <= 6) {
    return "***";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function isRateLimitPayload(item: Record<string, unknown>): boolean {
  return typeof item.api_key === "string" && isRecord(item.rate_limit);
}

function renderRateLimitSummary(item: Record<string, unknown>): string[] {
  const rateLimit = item.rate_limit as Record<string, unknown>;
  const lines = [
    `- api_key ${pc.dim(String(item.api_key))}`,
    `- credits ${pc.dim(`${stringifyRateValue(rateLimit.credits_used)} / ${stringifyRateValue(rateLimit.credits_limit)} used, ${stringifyRateValue(rateLimit.credits_remaining)} remaining`)}`,
    `- daily usd ${pc.dim(`${stringifyRateValue(rateLimit.daily_used_usd)} / ${stringifyRateValue(rateLimit.daily_budget_usd)} used, ${stringifyRateValue(rateLimit.daily_remaining_usd)} remaining`)}`,
    `- resets ${pc.dim(`${stringifyRateValue(rateLimit.resets_at)} (${stringifyRateValue(rateLimit.resets_in_seconds)}s)`)}`,
  ];

  if (item.is_grandfathered !== undefined) {
    lines.push(`- grandfathered ${pc.dim(String(item.is_grandfathered))}`);
  }

  return lines;
}

function stringifyRateValue(value: unknown): string {
  return value === undefined || value === null ? "unknown" : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function summarizeGroup(row: Record<string, unknown>): string {
  const key = String(row.key_display_name ?? row.key ?? row.id ?? "unknown");
  const count = row.count !== undefined ? String(row.count) : "";
  return `- ${key}${count ? ` ${pc.dim(`(${count})`)}` : ""}`;
}
