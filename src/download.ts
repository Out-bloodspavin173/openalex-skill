import fs from "node:fs/promises";
import process from "node:process";
import path from "node:path";

import { OpenAlexClient } from "./openalex.js";

const DOWNLOAD_USER_AGENT = "openalex-skill/0.1.2";

export interface DownloadWorkOptions {
  output?: string;
  overwrite?: boolean;
  onProgress?: (message: string) => void;
}

export interface DownloadWorkResult {
  workId: string;
  title?: string;
  filePath: string;
  sourceField: string;
  sourceUrl: string;
  finalUrl: string;
  contentType?: string;
  bytes: number;
}

interface DownloadCandidate {
  field: string;
  url: string;
}

interface DownloadAttemptFailure {
  candidate: DownloadCandidate;
  reason: string;
}

interface DownloadResolution {
  finalUrl: string;
  contentType?: string;
  extension: string;
}

const TOP_LEVEL_CANDIDATE_PATHS: Array<{ field: string; path: string[] }> = [
  { field: "primary_location.pdf_url", path: ["primary_location", "pdf_url"] },
  { field: "best_oa_location.pdf_url", path: ["best_oa_location", "pdf_url"] },
  { field: "open_access.oa_url", path: ["open_access", "oa_url"] },
  { field: "content_urls.pdf", path: ["content_urls", "pdf"] },
  { field: "content_urls.grobid_xml", path: ["content_urls", "grobid_xml"] },
  { field: "primary_location.landing_page_url", path: ["primary_location", "landing_page_url"] },
  { field: "best_oa_location.landing_page_url", path: ["best_oa_location", "landing_page_url"] },
];

export async function downloadWorkFile(
  client: OpenAlexClient,
  workId: string,
  options: DownloadWorkOptions = {},
): Promise<DownloadWorkResult> {
  reportProgress(options.onProgress, `Resolving work metadata: ${workId}`);
  const work = (await client.get("works", workId)).data;
  if (!work) {
    throw new Error(`OpenAlex returned no work payload for: ${workId}`);
  }

  const candidates = collectDownloadCandidates(work);
  if (candidates.length === 0) {
    throw new Error(buildNoCandidateMessage(workId, work));
  }

  reportProgress(options.onProgress, `Found ${candidates.length} download candidate(s).`);
  const failures: DownloadAttemptFailure[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    reportProgress(options.onProgress, `Trying candidate ${index + 1}/${candidates.length}: ${candidate.field}`);
    try {
      return await tryDownloadCandidate(client, work, candidate, options);
    } catch (error) {
      failures.push({
        candidate,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(buildDownloadFailureMessage(workId, failures));
}

function collectDownloadCandidates(work: Record<string, unknown>): DownloadCandidate[] {
  const candidates: DownloadCandidate[] = [];
  const seen = new Set<string>();
  const pushCandidate = createCandidateCollector(candidates, seen);

  for (const candidatePath of TOP_LEVEL_CANDIDATE_PATHS) {
    pushCandidate(candidatePath.field, readNestedString(work, candidatePath.path));
  }

  const locations = work.locations;
  if (Array.isArray(locations)) {
    for (let index = 0; index < locations.length; index += 1) {
      const location = locations[index];
      if (!isRecord(location)) {
        continue;
      }

      for (const locationCandidate of collectLocationCandidates(location, index)) {
        pushCandidate(locationCandidate.field, locationCandidate.value);
      }
    }
  }

  return candidates;
}

async function tryDownloadCandidate(
  client: OpenAlexClient,
  work: Record<string, unknown>,
  candidate: DownloadCandidate,
  options: DownloadWorkOptions,
): Promise<DownloadWorkResult> {
  const parsedUrl = resolveRequestUrl(client, candidate.url);

  const response = await fetch(parsedUrl, {
    redirect: "follow",
    headers: {
      Accept: "application/pdf, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1",
      "User-Agent": DOWNLOAD_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`download request failed (${response.status} ${response.statusText})`);
  }

  const resolvedDownload = resolveDownloadResponse(response, parsedUrl);

  reportProgress(
    options.onProgress,
    buildDownloadStartMessage(candidate.field, resolvedDownload.finalUrl, response.headers.get("content-length")),
  );
  const bytes = await readResponseBytes(response, options.onProgress);
  if (bytes.length === 0) {
    throw new Error("response body was empty");
  }

  const filePath = resolveOutputPath(work, resolvedDownload.extension, options.output);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (!options.overwrite && (await pathExists(filePath))) {
    throw new Error(`output file already exists: ${filePath}`);
  }

  await fs.writeFile(filePath, bytes);
  reportProgress(options.onProgress, `Saved ${formatBytes(bytes.length)} to ${filePath}`);

  return {
    workId: readWorkId(work),
    title: readWorkTitle(work),
    filePath,
    sourceField: candidate.field,
    sourceUrl: candidate.url,
    finalUrl: resolvedDownload.finalUrl,
    contentType: resolvedDownload.contentType,
    bytes: bytes.length,
  };
}

function createCandidateCollector(candidates: DownloadCandidate[], seen: Set<string>): (field: string, value: unknown) => void {
  return (field: string, value: unknown) => {
    if (typeof value !== "string") {
      return;
    }

    const url = value.trim();
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    candidates.push({ field, url });

    for (const derived of deriveDirectFileUrls(url)) {
      if (seen.has(derived.url)) {
        continue;
      }

      seen.add(derived.url);
      candidates.push({
        field: `${field} (${derived.label})`,
        url: derived.url,
      });
    }
  };
}

function collectLocationCandidates(location: Record<string, unknown>, index: number): Array<{ field: string; value: unknown }> {
  return [
    { field: `locations[${index}].pdf_url`, value: location.pdf_url },
    { field: `locations[${index}].landing_page_url`, value: location.landing_page_url },
  ];
}

function resolveRequestUrl(client: OpenAlexClient, rawUrl: string): URL {
  const authorizedUrl = client.authorizeDownloadUrl(rawUrl);
  try {
    return new URL(authorizedUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }
}

function resolveDownloadResponse(response: Response, requestUrl: URL): DownloadResolution {
  const finalUrl = sanitizeReportedUrl(response.url || requestUrl.toString());
  const contentType = normalizeContentType(response.headers.get("content-type"));
  const extension = inferExtension(contentType, finalUrl, response.headers.get("content-disposition"));
  if (!extension) {
    throw new Error(`response was not a direct PDF/XML file (content-type: ${contentType ?? "unknown"})`);
  }

  return {
    finalUrl,
    contentType,
    extension,
  };
}

interface DerivedUrl {
  label: string;
  url: string;
}

function deriveDirectFileUrls(rawUrl: string): DerivedUrl[] {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return [];
  }

  const arxivId = readArxivIdFromUrl(parsedUrl);
  if (!arxivId) {
    return [];
  }

  return [{
    label: "derived arXiv pdf",
    url: `https://arxiv.org/pdf/${arxivId}.pdf`,
  }];
}

function readArxivIdFromUrl(url: URL): string | undefined {
  if (/^doi\.org$/i.test(url.hostname)) {
    const doiMatch = url.pathname.match(/^\/10\.48550\/arxiv\/(.+)$/i) ?? url.pathname.match(/^\/10\.48550\/arxiv\.([^?#]+)$/i);
    if (doiMatch?.[1]) {
      return doiMatch[1].replace(/\.pdf$/i, "");
    }
  }

  if (/^arxiv\.org$/i.test(url.hostname)) {
    const absMatch = url.pathname.match(/^\/abs\/(.+)$/i);
    if (absMatch?.[1]) {
      return absMatch[1].replace(/\.pdf$/i, "");
    }

    const pdfMatch = url.pathname.match(/^\/pdf\/(.+?)(?:\.pdf)?$/i);
    if (pdfMatch?.[1]) {
      return pdfMatch[1];
    }
  }

  return undefined;
}

async function readResponseBytes(response: Response, onProgress: DownloadWorkOptions["onProgress"]): Promise<Buffer> {
  const contentLength = parseOptionalInt(response.headers.get("content-length"));
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Buffer[] = [];
  let totalRead = 0;
  let nextPercentThreshold = 10;
  let nextByteThreshold = 1024 * 1024;
  let emittedCompleteProgress = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = Buffer.from(value);
    chunks.push(chunk);
    totalRead += chunk.length;

    if (contentLength && contentLength > 0) {
      const percent = Math.floor((totalRead / contentLength) * 100);
      if (percent >= nextPercentThreshold) {
        const clampedPercent = Math.min(percent, 100);
        reportProgress(onProgress, `Download progress: ${clampedPercent}% (${formatBytes(totalRead)} / ${formatBytes(contentLength)})`);
        if (clampedPercent === 100) {
          emittedCompleteProgress = true;
        }
        nextPercentThreshold += 10;
      }
      continue;
    }

    if (totalRead >= nextByteThreshold) {
      reportProgress(onProgress, `Download progress: ${formatBytes(totalRead)} received`);
      nextByteThreshold += 1024 * 1024;
    }
  }

  if (contentLength && totalRead > 0 && !emittedCompleteProgress) {
    reportProgress(onProgress, `Download progress: 100% (${formatBytes(totalRead)} / ${formatBytes(contentLength)})`);
  }

  return Buffer.concat(chunks);
}

function buildDownloadStartMessage(field: string, finalUrl: string, contentLength: string | null): string {
  const size = parseOptionalInt(contentLength);
  const renderedSize = size && size > 0 ? formatBytes(size) : "unknown size";
  return `Downloading from ${field}: ${finalUrl} (${renderedSize})`;
}

function reportProgress(onProgress: DownloadWorkOptions["onProgress"], message: string): void {
  onProgress?.(message);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveOutputPath(work: Record<string, unknown>, extension: string, explicitOutput: string | undefined): string {
  if (explicitOutput) {
    return path.resolve(explicitOutput);
  }

  const baseName = buildDefaultBaseName(work);
  return path.resolve(`${baseName}${extension}`);
}

function buildDefaultBaseName(work: Record<string, unknown>): string {
  const doi = readWorkDoi(work);
  if (doi) {
    return sanitizeFileName(doi.replace(/^https?:\/\/doi\.org\//i, ""));
  }

  const workId = readWorkId(work);
  if (workId) {
    return sanitizeFileName(workId);
  }

  const title = readWorkTitle(work);
  if (title) {
    return sanitizeFileName(title);
  }

  return "openalex-work";
}

function sanitizeFileName(value: string): string {
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || /[<>:"/\\|?*]/.test(character)) {
      return "_";
    }

    return character;
  }).join("").replace(/\s+/g, " ").trim();

  return sanitized || "openalex-work";
}

function readWorkId(work: Record<string, unknown>): string {
  const raw = typeof work.id === "string" ? work.id : undefined;
  return raw ? raw.replace("https://openalex.org/", "") : "unknown-work";
}

function readWorkDoi(work: Record<string, unknown>): string | undefined {
  return typeof work.doi === "string" ? work.doi : undefined;
}

function readWorkTitle(work: Record<string, unknown>): string | undefined {
  const title = work.display_name;
  return typeof title === "string" ? title : undefined;
}

function inferExtension(contentType: string | undefined, finalUrl: string, contentDisposition?: string | null): string | undefined {
  if (contentType?.includes("pdf")) {
    return ".pdf";
  }

  const lowerPath = readLowerCasePathname(finalUrl);
  const pathExtension = inferExtensionFromName(lowerPath);
  if (pathExtension) {
    return pathExtension;
  }

  if (contentType?.includes("xml") || lowerPath.endsWith(".xml")) {
    return lowerPath.endsWith(".tei.xml") ? ".tei.xml" : ".xml";
  }

  const lowerFileName = readLowerCaseFileName(contentDisposition);
  if (lowerFileName) {
    return inferExtensionFromName(lowerFileName);
  }

  return undefined;
}

function inferExtensionFromName(value: string): string | undefined {
  if (value.endsWith(".tei.xml.gz")) {
    return ".tei.xml.gz";
  }

  if (value.endsWith(".xml.gz")) {
    return ".xml.gz";
  }

  if (value.endsWith(".tei.xml")) {
    return ".tei.xml";
  }

  if (value.endsWith(".grobid-xml") || value.endsWith(".grobid.xml")) {
    return ".grobid.xml";
  }

  if (value.endsWith(".xml")) {
    return ".xml";
  }

  if (value.endsWith(".pdf")) {
    return ".pdf";
  }

  return undefined;
}

function normalizeContentType(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.split(";", 1)[0]?.trim().toLowerCase();
}

function sanitizeReportedUrl(rawUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  parsedUrl.searchParams.delete("api_key");
  parsedUrl.searchParams.delete("mailto");
  return parsedUrl.toString();
}

function readLowerCaseFileName(contentDisposition: string | null | undefined): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponentSafe(utf8Match[1]).toLowerCase();
  }

  const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].toLowerCase();
  }

  const bareMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (bareMatch?.[1]) {
    return bareMatch[1].trim().toLowerCase();
  }

  return undefined;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readLowerCasePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildNoCandidateMessage(workId: string, work: Record<string, unknown>): string {
  const title = readWorkTitle(work);
  const detail = title ? ` (${title})` : "";
  return `No download candidates were available for ${workId}${detail}. OpenAlex returned no PDF URL, OA URL, or landing page URL for this work.`;
}

function buildDownloadFailureMessage(workId: string, failures: DownloadAttemptFailure[]): string {
  const lines = [`Unable to download full text for ${workId}. Tried ${failures.length} candidate URL(s):`];
  for (const failure of failures) {
    lines.push(`- ${failure.candidate.field}: ${failure.reason}`);
  }

  return lines.join("\n");
}

function readNestedString(value: Record<string, unknown>, pathSegments: string[]): string | undefined {
  let current: unknown = value;
  for (const segment of pathSegments) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "string" ? current : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createDownloadProgressReporter(stream: NodeJS.WriteStream = process.stderr): (message: string) => void {
  return (message: string) => {
    stream.write(`${message}\n`);
  };
}
