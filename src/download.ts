import fs from "node:fs/promises";
import path from "node:path";

import { OpenAlexClient } from "./openalex.js";

const DOWNLOAD_USER_AGENT = "openalex-skill/0.1.0";

export interface DownloadWorkOptions {
  output?: string;
  overwrite?: boolean;
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

export async function downloadWorkFile(
  client: OpenAlexClient,
  workId: string,
  options: DownloadWorkOptions = {},
): Promise<DownloadWorkResult> {
  const work = (await client.get("works", workId)).data;
  if (!work) {
    throw new Error(`OpenAlex returned no work payload for: ${workId}`);
  }

  const candidates = collectDownloadCandidates(work);
  if (candidates.length === 0) {
    throw new Error(buildNoCandidateMessage(workId, work));
  }

  const failures: DownloadAttemptFailure[] = [];
  for (const candidate of candidates) {
    try {
      return await tryDownloadCandidate(work, candidate, options);
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

  const pushCandidate = (field: string, value: unknown) => {
    if (typeof value !== "string") {
      return;
    }

    const url = value.trim();
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    candidates.push({ field, url });
  };

  pushCandidate("primary_location.pdf_url", readNestedString(work, ["primary_location", "pdf_url"]));
  pushCandidate("best_oa_location.pdf_url", readNestedString(work, ["best_oa_location", "pdf_url"]));
  pushCandidate("open_access.oa_url", readNestedString(work, ["open_access", "oa_url"]));
  pushCandidate("primary_location.landing_page_url", readNestedString(work, ["primary_location", "landing_page_url"]));
  pushCandidate("best_oa_location.landing_page_url", readNestedString(work, ["best_oa_location", "landing_page_url"]));

  const locations = work.locations;
  if (Array.isArray(locations)) {
    for (let index = 0; index < locations.length; index += 1) {
      const location = locations[index];
      if (!isRecord(location)) {
        continue;
      }

      pushCandidate(`locations[${index}].pdf_url`, location.pdf_url);
      pushCandidate(`locations[${index}].landing_page_url`, location.landing_page_url);
    }
  }

  return candidates;
}

async function tryDownloadCandidate(
  work: Record<string, unknown>,
  candidate: DownloadCandidate,
  options: DownloadWorkOptions,
): Promise<DownloadWorkResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate.url);
  } catch {
    throw new Error(`invalid URL: ${candidate.url}`);
  }

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

  const finalUrl = response.url || parsedUrl.toString();
  const contentType = normalizeContentType(response.headers.get("content-type"));
  const extension = inferExtension(contentType, finalUrl);
  if (!extension) {
    throw new Error(`response was not a direct PDF/XML file (content-type: ${contentType ?? "unknown"})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("response body was empty");
  }

  const filePath = resolveOutputPath(work, extension, options.output);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (!options.overwrite && (await pathExists(filePath))) {
    throw new Error(`output file already exists: ${filePath}`);
  }

  await fs.writeFile(filePath, bytes);

  return {
    workId: readWorkId(work),
    title: readWorkTitle(work),
    filePath,
    sourceField: candidate.field,
    sourceUrl: candidate.url,
    finalUrl,
    contentType,
    bytes: bytes.length,
  };
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

function inferExtension(contentType: string | undefined, finalUrl: string): string | undefined {
  if (contentType?.includes("pdf")) {
    return ".pdf";
  }

  const lowerUrl = finalUrl.toLowerCase();
  if (lowerUrl.endsWith(".tei.xml")) {
    return ".tei.xml";
  }

  if (contentType?.includes("xml") || lowerUrl.endsWith(".xml")) {
    return lowerUrl.endsWith(".tei.xml") ? ".tei.xml" : ".xml";
  }

  if (lowerUrl.endsWith(".pdf")) {
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
