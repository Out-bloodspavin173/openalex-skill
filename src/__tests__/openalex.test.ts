import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "process";

import { buildCli } from "../cli.js";
import { getConfig, getConfigPath } from "../config.js";
import { downloadWorkFile } from "../download.js";
import { OpenAlexClient } from "../openalex.js";
import { readPackageVersion } from "../command-helpers.js";
import { renderEnvelope } from "../render.js";

function textToArrayBuffer(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

describe("OpenAlexClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("builds list requests with OpenAlex query parameters", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({
        "x-ratelimit-limit": "1000",
        "x-ratelimit-remaining": "999",
      }),
      json: async () => ({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W1" }] }),
    });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: "dev@example.com",
    });

    await client.list("works", {
      filter: ["publication_year:2024", "is_oa:true"],
      search: "graph neural networks",
      select: ["id", "display_name"],
      perPage: 5,
      includeXpac: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toContain("/works?");
    expect(url.searchParams.get("filter")).toBe("publication_year:2024,is_oa:true");
    expect(url.searchParams.get("search")).toBe("graph neural networks");
    expect(url.searchParams.get("select")).toBe("id,display_name");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(url.searchParams.get("include_xpac")).toBe("true");
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(url.searchParams.get("mailto")).toBe("dev@example.com");
  });

  it("uses official citation filters for cited-by and references helpers", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W2159974629",
          related_works: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W2" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W2159974629",
          related_works: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W3" }] }),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    await client.getCitedByWorks("https://doi.org/10.1038/nature12373", { perPage: 5 });
    await client.getReferencedWorks("https://doi.org/10.1038/nature12373", { perPage: 5 });

    const citedByUrl = fetchMock.mock.calls[1]?.[0] as URL;
    const referencesUrl = fetchMock.mock.calls[3]?.[0] as URL;

    expect(citedByUrl.searchParams.get("filter")).toBe("cites:W2159974629");
    expect(referencesUrl.searchParams.get("filter")).toBe("cited_by:W2159974629");
  });

  it("supports list options for related works", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W2159974629",
          related_works: [
            "https://openalex.org/W1",
            "https://openalex.org/W2",
            "https://openalex.org/W3",
            "https://openalex.org/W4",
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({ meta: { count: 4 }, results: [{ id: "https://openalex.org/W1" }] }),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    await client.getRelatedWorks("https://doi.org/10.1038/nature12373", { perPage: 2, select: ["id"] });

    const relatedUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(relatedUrl.searchParams.get("filter")).toBe("openalex:W1|W2|W3|W4");
    expect(relatedUrl.searchParams.get("per_page")).toBe("2");
    expect(relatedUrl.searchParams.get("select")).toBe("id");
  });

  it("adds a helpful hint when a work lookup returns 404", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "missing",
      headers: new Headers(),
    });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    await expect(client.get("works", "W404")).rejects.toThrow(/`related`, `cited-by`, or `references`/);
  });

  it("does not add the works hint to unrelated 404 paths", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "missing",
      headers: new Headers(),
    });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    await expect(client.get("authors", "A404")).rejects.not.toThrow(/works get <id-or-doi>/);
  });

  it("sanitizes upstream HTML error pages", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "<!doctype html><html><body>bad gateway</body></html>",
      headers: new Headers(),
    });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    await expect(client.get("works", "W502")).rejects.toThrow(/upstream server returned an HTML error page/);
  });
});

describe("downloadWorkFile", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("downloads a PDF from the primary location URL", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-download-"));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W123",
          doi: "https://doi.org/10.1038/nature12373",
          display_name: "Example paper",
          primary_location: { pdf_url: "https://example.org/paper.pdf" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://cdn.example.org/paper.pdf",
        headers: new Headers({ "content-type": "application/pdf" }),
        arrayBuffer: async () => textToArrayBuffer("pdf-data"),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    const result = await downloadWorkFile(client, "W123", {
      output: path.join(tempDir, "paper.pdf"),
    });

    expect(result.sourceField).toBe("primary_location.pdf_url");
    expect(result.finalUrl).toBe("https://cdn.example.org/paper.pdf");
    expect(result.filePath).toBe(path.join(tempDir, "paper.pdf"));
    expect(fs.readFileSync(result.filePath, "utf8")).toBe("pdf-data");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("falls back when the OA URL resolves to HTML instead of a file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-download-"));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W124",
          display_name: "Fallback paper",
          open_access: { oa_url: "https://example.org/landing" },
          locations: [{ pdf_url: "https://example.org/file.pdf" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://example.org/landing",
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        arrayBuffer: async () => textToArrayBuffer("<html></html>"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://example.org/file.pdf",
        headers: new Headers({ "content-type": "application/pdf" }),
        arrayBuffer: async () => textToArrayBuffer("fallback-pdf"),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    const result = await downloadWorkFile(client, "W124", {
      output: path.join(tempDir, "fallback.pdf"),
    });

    expect(result.sourceField).toBe("locations[0].pdf_url");
    expect(fs.readFileSync(result.filePath, "utf8")).toBe("fallback-pdf");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("derives an arXiv PDF URL from a DOI landing page candidate", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-download-"));
    const progress: string[] = [];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W7140161630",
          display_name: "SkillProbe",
          open_access: { oa_url: "https://doi.org/10.48550/arxiv.2603.21019" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://arxiv.org/abs/2603.21019",
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        arrayBuffer: async () => textToArrayBuffer("<html></html>"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://arxiv.org/pdf/2603.21019.pdf",
        headers: new Headers({
          "content-type": "application/pdf",
          "content-length": "8",
        }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("pdf-data"));
            controller.close();
          },
        }),
        arrayBuffer: async () => textToArrayBuffer("pdf-data"),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    const result = await downloadWorkFile(client, "W7140161630", {
      output: path.join(tempDir, "skillprobe.pdf"),
      onProgress: (message) => progress.push(message),
    });

    expect(result.sourceField).toBe("open_access.oa_url (derived arXiv pdf)");
    expect(result.finalUrl).toBe("https://arxiv.org/pdf/2603.21019.pdf");
    expect(fs.readFileSync(result.filePath, "utf8")).toBe("pdf-data");
    expect(progress.some((message) => message.includes("Trying candidate 2/2"))).toBe(true);
    expect(progress.some((message) => message.includes("Download progress:"))).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("derives an arXiv PDF URL for legacy slash-style arXiv identifiers", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-download-"));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W125",
          display_name: "Legacy arXiv paper",
          open_access: { oa_url: "https://arxiv.org/abs/hep-th/9901001" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://arxiv.org/abs/hep-th/9901001",
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        arrayBuffer: async () => textToArrayBuffer("<html></html>"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://arxiv.org/pdf/hep-th/9901001.pdf",
        headers: new Headers({ "content-type": "application/pdf" }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("legacy-pdf"));
            controller.close();
          },
        }),
        arrayBuffer: async () => textToArrayBuffer("legacy-pdf"),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    const result = await downloadWorkFile(client, "W125", {
      output: path.join(tempDir, "legacy.pdf"),
    });

    expect(result.sourceField).toBe("open_access.oa_url (derived arXiv pdf)");
    expect(result.finalUrl).toBe("https://arxiv.org/pdf/hep-th/9901001.pdf");
    expect(fs.readFileSync(result.filePath, "utf8")).toBe("legacy-pdf");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("emits a single 100 percent progress update", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-download-"));
    const progress: string[] = [];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W126",
          display_name: "Progress paper",
          primary_location: { pdf_url: "https://example.org/one-chunk.pdf" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://example.org/one-chunk.pdf",
        headers: new Headers({
          "content-type": "application/pdf",
          "content-length": "8",
        }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("pdf-data"));
            controller.close();
          },
        }),
        arrayBuffer: async () => textToArrayBuffer("pdf-data"),
      });

    const client = new OpenAlexClient({
      apiKey: "test-key",
      baseUrl: "https://api.openalex.org",
      mailto: undefined,
    });

    await downloadWorkFile(client, "W126", {
      output: path.join(tempDir, "progress.pdf"),
      onProgress: (message) => progress.push(message),
    });

    expect(progress.filter((message) => message.includes("Download progress: 100%")).length).toBe(1);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("config", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalApiKey = process.env.OPENALEX_API_KEY;
  const originalBaseUrl = process.env.OPENALEX_BASE_URL;
  const originalMailto = process.env.OPENALEX_MAILTO;

  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-skill-test-"));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.OPENALEX_API_KEY;
    delete process.env.OPENALEX_BASE_URL;
    delete process.env.OPENALEX_MAILTO;
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalApiKey === undefined) {
      delete process.env.OPENALEX_API_KEY;
    } else {
      process.env.OPENALEX_API_KEY = originalApiKey;
    }

    if (originalBaseUrl === undefined) {
      delete process.env.OPENALEX_BASE_URL;
    } else {
      process.env.OPENALEX_BASE_URL = originalBaseUrl;
    }

    if (originalMailto === undefined) {
      delete process.env.OPENALEX_MAILTO;
    } else {
      process.env.OPENALEX_MAILTO = originalMailto;
    }
  });

  it("loads config from the persistent user config file", () => {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(
      getConfigPath(),
      `${JSON.stringify({ apiKey: "stored-key", baseUrl: "https://example.test", mailto: "stored@example.com" }, null, 2)}\n`,
      "utf8",
    );

    expect(getConfig()).toEqual({
      apiKey: "stored-key",
      baseUrl: "https://example.test",
      mailto: "stored@example.com",
    });
  });

  it("prefers environment variables over stored config", () => {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(
      getConfigPath(),
      `${JSON.stringify({ apiKey: "stored-key", baseUrl: "https://example.test", mailto: "stored@example.com" }, null, 2)}\n`,
      "utf8",
    );
    process.env.OPENALEX_API_KEY = "env-key";
    process.env.OPENALEX_BASE_URL = "https://env.test";
    process.env.OPENALEX_MAILTO = "env@example.com";

    expect(getConfig()).toEqual({
      apiKey: "env-key",
      baseUrl: "https://env.test",
      mailto: "env@example.com",
    });
  });

  it("treats empty environment variables as unset", () => {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(
      getConfigPath(),
      `${JSON.stringify({ apiKey: "stored-key", baseUrl: "https://example.test", mailto: "stored@example.com" }, null, 2)}\n`,
      "utf8",
    );
    process.env.OPENALEX_API_KEY = "";
    process.env.OPENALEX_BASE_URL = "";
    process.env.OPENALEX_MAILTO = "";

    expect(getConfig()).toEqual({
      apiKey: "stored-key",
      baseUrl: "https://example.test",
      mailto: "stored@example.com",
    });
  });

  it("throws a readable error when the persistent config file is malformed", () => {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(getConfigPath(), "{bad json", "utf8");

    expect(() => getConfig()).toThrow(/Failed to read OpenAlex config/);
    expect(() => getConfig()).toThrow(/Fix or remove the file and try again/);
  });
});

describe("CLI integration", () => {
  const fetchMock = vi.fn();
  const stdoutSpy = vi.spyOn(process.stdout, "write");
  const stderrSpy = vi.spyOn(process.stderr, "write");

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    stdoutSpy.mockImplementation(() => true);
    stderrSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    stdoutSpy.mockReset();
    stderrSpy.mockReset();
    delete process.env.OPENALEX_API_KEY;
  });

  it("passes global format option down to entity subcommands", async () => {
    process.env.OPENALEX_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W1", display_name: "Test Paper" }] }),
    });

    const cli = buildCli();
    await cli.parseAsync(["--format", "json", "works", "search", "test"], { from: "user" });

    expect(stdoutSpy).toHaveBeenCalled();
    const firstCall = stdoutSpy.mock.calls[0]?.[0];
    expect(String(firstCall)).toContain('"results"');
    expect(String(firstCall)).toContain('"Test Paper"');
  });

  it("defaults to summary output when no format is specified", async () => {
    process.env.OPENALEX_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W1", display_name: "Test Paper" }] }),
    });

    const cli = buildCli();
    await cli.parseAsync(["works", "search", "test"], { from: "user" });

    const firstCall = stdoutSpy.mock.calls[0]?.[0];
    expect(String(firstCall)).toContain("Works search: test");
    expect(String(firstCall)).toContain("Test Paper");
    expect(String(firstCall)).not.toContain('"results"');
  });

  it("lists curated field paths without making an API request", async () => {
    const cli = buildCli();
    await cli.parseAsync(["works", "fields"], { from: "user" });

    expect(fetchMock).not.toHaveBeenCalled();
    const firstCall = stdoutSpy.mock.calls[0]?.[0];
    expect(String(firstCall)).toContain("Works fields");
    expect(String(firstCall)).toContain("title");
    expect(String(firstCall)).toContain("authorships.author.display_name");
    expect(String(firstCall)).toContain("Use these paths with --field <path>");
  });

  it("supports the version command and global version flag", async () => {
    const cli = buildCli();
    await cli.parseAsync(["version"], { from: "user" });

    const firstCall = stdoutSpy.mock.calls[0]?.[0];
    expect(String(firstCall)).toContain(readPackageVersion());
    expect(buildCli().version()).toBe(readPackageVersion());
  });

  it("supports persistent config commands", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-cli-config-"));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.OPENALEX_API_KEY;
    delete process.env.OPENALEX_BASE_URL;
    delete process.env.OPENALEX_MAILTO;

    await buildCli().parseAsync(["config", "set", "api-key", "secret-token"], { from: "user" });
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toContain("Saved apiKey=secr...oken");

    stdoutSpy.mockClear();
    await buildCli().parseAsync(["config"], { from: "user" });
    const summary = String(stdoutSpy.mock.calls[0]?.[0]);
    expect(summary).toContain("OpenAlex config");
    expect(summary).toContain("stored.apiKey: secr...oken");

    stdoutSpy.mockClear();
    await buildCli().parseAsync(["config", "path"], { from: "user" });
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toContain(path.join(".openalex-skill", "config.json"));

    fs.rmSync(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("still supports version and config path when stored config is malformed", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-cli-bad-config-"));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;

    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    fs.mkdirSync(path.join(tempHome, ".openalex-skill"), { recursive: true });
    fs.writeFileSync(path.join(tempHome, ".openalex-skill", "config.json"), "{bad json", "utf8");

    await buildCli().parseAsync(["version"], { from: "user" });
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toContain(readPackageVersion());

    stdoutSpy.mockClear();
    await buildCli().parseAsync(["config", "path"], { from: "user" });
    expect(String(stdoutSpy.mock.calls[0]?.[0])).toContain(path.join(".openalex-skill", "config.json"));

    await expect(buildCli().parseAsync(["config"], { from: "user" })).rejects.toThrow(/Failed to read OpenAlex config/);

    fs.rmSync(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("shows richer entity descriptions in top-level help", async () => {
    const helpText = buildCli().helpInformation().replace(/\s+/g, " ");
    expect(helpText).toContain("works Search papers, look up DOIs, download open-access full text, and trace citations or related works.");
    expect(helpText).toContain("authors Find researchers, ORCID profiles, affiliations, and author-level metrics.");
  });

  it("downloads a work file through the CLI", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openalex-cli-download-"));
    const outputPath = path.join(tempDir, "cli-paper.pdf");

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          id: "https://openalex.org/W999",
          display_name: "CLI paper",
          primary_location: { pdf_url: "https://example.org/cli-paper.pdf" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://example.org/cli-paper.pdf",
        headers: new Headers({ "content-type": "application/pdf" }),
        arrayBuffer: async () => textToArrayBuffer("cli-pdf"),
      });

    const cli = buildCli();
    await cli.parseAsync(["works", "download", "W999", "--output", outputPath], { from: "user" });

    const firstCall = String(stdoutSpy.mock.calls[0]?.[0]);
    const stderrOutput = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(firstCall).toContain("Downloaded work full text: W999");
    expect(firstCall).toContain(`saved: ${outputPath}`);
    expect(firstCall).toContain("source: primary_location.pdf_url");
    expect(stderrOutput).toContain("Resolving work metadata: W999");
    expect(stderrOutput).toContain("Trying candidate 1/1: primary_location.pdf_url");
    expect(fs.readFileSync(outputPath, "utf8")).toBe("cli-pdf");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("renders grouped responses as human-readable summaries", () => {
    const output = renderEnvelope(
      { format: "summary", title: "Works group by publication_year" },
      {
        meta: { count: 3, page: 1, per_page: 3, groups_count: 3 },
        group_by: [
          { key: "2020", key_display_name: "2020", count: 10 },
          { key: "2021", key_display_name: "2021", count: 12 },
        ],
        results: [],
      },
    );

    expect(output).toContain("Works group by publication_year");
    expect(output).toContain("2020");
    expect(output).toContain("10");
    expect(output).not.toContain("No results.");
  });

  it("prefers results over an empty group_by array for search summaries and jsonl", () => {
    const payload = {
      meta: { count: 2, page: 1, per_page: 25 },
      group_by: [],
      results: [
        {
          id: "https://openalex.org/W1",
          display_name: "SkillRouter: Retrieve-and-Rerank Skill Selection for LLM Agents at Scale",
          publication_year: 2026,
          type: "article",
          cited_by_count: 0,
          authorships: [{ author: { display_name: "YanZhao Zheng" } }],
        },
      ],
    };

    const summaryOutput = renderEnvelope(
      { format: "summary", title: "Works search: skillrouter" },
      payload,
    );
    const jsonlOutput = renderEnvelope(
      { format: "jsonl", title: "Works search: skillrouter" },
      payload,
    );

    expect(summaryOutput).toContain("SkillRouter: Retrieve-and-Rerank Skill Selection for LLM Agents at Scale");
    expect(summaryOutput).toContain("YanZhao Zheng");
    expect(jsonlOutput).toContain('"display_name":"SkillRouter: Retrieve-and-Rerank Skill Selection for LLM Agents at Scale"');
  });

  it("renders work summaries with venue, oa status, topic, authors, and doi", () => {
    const output = renderEnvelope(
      { format: "summary", title: "Works search: expel", entity: "works" },
      {
        meta: { count: 1, page: 1, per_page: 25 },
        results: [
          {
            title: "ExpeL: LLM Agents Are Experiential Learners",
            publication_year: 2024,
            cited_by_count: 74,
            doi: "https://doi.org/10.1609/aaai.v38i17.29936",
            open_access: { oa_status: "diamond" },
            primary_location: { source: { display_name: "Proceedings of the AAAI Conference on Artificial Intelligence" } },
            primary_topic: { display_name: "Multi-Agent Systems and Negotiation" },
            authorships: [
              { author: { display_name: "Andrew Zhao" } },
              { author: { display_name: "Daniel Huang" } },
              { author: { display_name: "Quentin Xu" } },
              { author: { display_name: "Gao Huang" } },
            ],
          },
        ],
      },
    );

    expect(output).toContain("OA diamond");
    expect(output).toContain("AAAI Conference on Artificial Intelligence");
    expect(output).toContain("Multi-Agent Systems and Negotiation");
    expect(output).toContain("authors: Andrew Zhao, Daniel Huang, Quentin Xu + 1 more");
    expect(output).toContain("doi: https://doi.org/10.1609/aaai.v38i17.29936");
  });

  it("renders author summaries with h-index, institution, and orcid", () => {
    const output = renderEnvelope(
      { format: "summary", title: "Authors search: geoffrey hinton", entity: "authors" },
      {
        meta: { count: 1, page: 1, per_page: 25 },
        results: [
          {
            display_name: "Geoffrey Hinton",
            works_count: 512,
            cited_by_count: 120000,
            orcid: "https://orcid.org/0000-0000-0000-0001",
            summary_stats: { h_index: 198 },
            last_known_institutions: [{ display_name: "University of Toronto" }],
          },
        ],
      },
    );

    expect(output).toContain("h-index 198");
    expect(output).toContain("University of Toronto");
    expect(output).toContain("orcid: https://orcid.org/0000-0000-0000-0001");
  });

  it("renders institution summaries with country, type, h-index, and ror", () => {
    const output = renderEnvelope(
      { format: "summary", title: "Institutions search: tsinghua", entity: "institutions" },
      {
        meta: { count: 1, page: 1, per_page: 25 },
        results: [
          {
            display_name: "Tsinghua University",
            country_code: "CN",
            type: "education",
            works_count: 100000,
            cited_by_count: 3000000,
            ror: "https://ror.org/03cve4549",
            summary_stats: { h_index: 410 },
          },
        ],
      },
    );

    expect(output).toContain("CN");
    expect(output).toContain("education");
    expect(output).toContain("h-index 410");
    expect(output).toContain("ror: https://ror.org/03cve4549");
  });

  it("renders rate-limit responses as meaningful summaries", () => {
    const output = renderEnvelope(
      { format: "summary", title: "Rate limit status" },
      {
        rateLimit: {},
        requestUrl: "https://api.openalex.org/rate-limit?api_key=test",
        data: {
          api_key: "bah...skE",
          is_grandfathered: false,
          rate_limit: {
            daily_budget_usd: 1,
            daily_used_usd: 0.0122,
            daily_remaining_usd: 0.9878,
            resets_at: "2026-04-02T00:00:00.000Z",
            resets_in_seconds: 79147,
            credits_limit: 10000,
            credits_used: 122,
            credits_remaining: 9878,
          },
        },
      },
    );

    expect(output).toContain("bah...skE");
    expect(output).toContain("122 / 10000 used, 9878 remaining");
    expect(output).toContain("0.0122 / 1 used, 0.9878 remaining");
    expect(output).not.toContain("Result 1");
  });

  it("redacts api_key values in requestUrl across structured outputs", () => {
    const payload = {
      requestUrl: "https://api.openalex.org/rate-limit?api_key=bahtVGjs0R2KmgVnq3OskE",
      data: {
        api_key: "bah...skE",
      },
    };

    const jsonOutput = renderEnvelope({ format: "json", title: "Rate limit status" }, payload);
    const markdownOutput = renderEnvelope({ format: "markdown", title: "Rate limit status" }, payload);

    expect(jsonOutput).toContain("bah...skE");
    expect(jsonOutput).toContain('"requestUrl": "https://api.openalex.org/rate-limit?api_key=bah...skE"');
    expect(jsonOutput).not.toContain("bahtVGjs0R2KmgVnq3OskE");
    expect(markdownOutput).toContain("api_key=bah...skE");
  });

  it("renders detail output from business fields instead of transport envelope fields", () => {
    const output = renderEnvelope(
      { format: "detail", title: "Works get W1" },
      {
        rateLimit: { limit: 10000, remaining: 9999 },
        requestUrl: "https://api.openalex.org/works/W1?api_key=bahtVGjs0R2KmgVnq3OskE",
        data: {
          id: "https://openalex.org/W1",
          display_name: "Test Paper",
          publication_year: 2024,
          authorships: [{ author: { display_name: "Alice" } }],
          ids: { openalex: "https://openalex.org/W1" },
        },
      },
    );

    expect(output).toContain("Works get W1");
    expect(output).toContain("display_name: Test Paper");
    expect(output).toContain("authorships:");
    expect(output).toContain("Alice");
    expect(output).not.toContain("requestUrl:");
    expect(output).not.toContain("rateLimit:");
    expect(output).not.toContain("bahtVGjs0R2KmgVnq3OskE");
  });

  it("does not truncate detail output by default", () => {
    const output = renderEnvelope(
      { format: "detail", title: "Works get W1" },
      {
        data: {
          abstract: "x".repeat(300),
          referenced_works: ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
        },
      },
    );

    expect(output).toContain("abstract: ");
    expect(output).toContain("referenced_works: W1, W2, W3, W4, W5, W6, W7");
    expect(output).toContain("x".repeat(300));
  });

  it("converts abstract_inverted_index into abstract text in detail output", () => {
    const output = renderEnvelope(
      { format: "detail", title: "Works get W1" },
      {
        data: {
          abstract_inverted_index: {
            The: [0],
            recent: [1],
            surge: [2],
          },
        },
      },
    );

    expect(output).toContain("abstract: The recent surge");
    expect(output).not.toContain("abstract_inverted_index");
  });

  it("projects only requested field paths before rendering", () => {
    const output = renderEnvelope(
      {
        format: "detail",
        title: "Works get W1",
        fields: ["title", "authorships.author.display_name", "abstract"],
      },
      {
        data: {
          title: "Test Paper",
          doi: "https://doi.org/10.1/test",
          authorships: [{ author: { display_name: "Alice", orcid: "https://orcid.org/x" } }],
          abstract: "Short abstract",
        },
      },
    );

    expect(output).toContain("title: Test Paper");
    expect(output).toContain("display_name: Alice");
    expect(output).toContain("abstract: Short abstract");
    expect(output).not.toContain("doi:");
    expect(output).not.toContain("orcid:");
  });

  it("projects abstract from abstract_inverted_index when abstract is requested", () => {
    const output = renderEnvelope(
      {
        format: "detail",
        title: "Works get W1",
        fields: ["title", "abstract"],
      },
      {
        data: {
          title: "Test Paper",
          abstract_inverted_index: {
            The: [0],
            recent: [1],
            surge: [2],
          },
        },
      },
    );

    expect(output).toContain("title: Test Paper");
    expect(output).toContain("abstract: The recent surge");
    expect(output).not.toContain("abstract_inverted_index");
  });

  it("projects abstract into json output when only abstract is requested", () => {
    const output = renderEnvelope(
      {
        format: "json",
        title: "Works get W1",
        fields: ["abstract"],
      },
      {
        data: {
          abstract_inverted_index: {
            The: [0],
            recent: [1],
            surge: [2],
          },
        },
      },
    );

    expect(output).toContain('"abstract": "The recent surge"');
    expect(output).not.toContain("abstract_inverted_index");
  });

  it("renders projected scalar arrays inline in detail output", () => {
    const output = renderEnvelope(
      {
        format: "detail",
        title: "Works get W1",
        fields: ["authorships.author.display_name"],
      },
      {
        data: {
          authorships: [
            { author: { display_name: "A1" } },
            { author: { display_name: "A2" } },
            { author: { display_name: "A3" } },
            { author: { display_name: "A4" } },
            { author: { display_name: "A5" } },
            { author: { display_name: "A6" } },
          ],
        },
      },
    );

    expect(output).toContain("display_name: A1, A2, A3, A4, A5, A6");
    expect(output).not.toContain("[6 items]");
  });

  it("keeps projected nested arrays structured in json output", () => {
    const output = renderEnvelope(
      {
        format: "json",
        title: "Works get W1",
        fields: ["authorships.author.display_name"],
      },
      {
        data: {
          authorships: [{ author: { display_name: "Alice" } }, { author: { display_name: "Bob" } }],
        },
      },
    );

    expect(output).toContain('"authorships": [');
    expect(output).toContain('"display_name": "Alice"');
    expect(output).toContain('"display_name": "Bob"');
  });

  it("keeps projected array fields aligned when some nested values are missing", () => {
    const output = renderEnvelope(
      {
        format: "json",
        title: "Works get W1",
        fields: ["authorships.author.display_name", "authorships.author.orcid"],
      },
      {
        data: {
          authorships: [
            { author: { display_name: "Alice", orcid: "https://orcid.org/0000-0000-0000-0001" } },
            { author: { display_name: "Bob" } },
            { author: { display_name: "Carol", orcid: "https://orcid.org/0000-0000-0000-0003" } },
          ],
        },
      },
    );

    const parsed = JSON.parse(output) as {
      data: { authorships: Array<{ author: { display_name: string; orcid?: string } }> };
    };

    expect(parsed.data.authorships).toEqual([
      { author: { display_name: "Alice", orcid: "https://orcid.org/0000-0000-0000-0001" } },
      { author: { display_name: "Bob" } },
      { author: { display_name: "Carol", orcid: "https://orcid.org/0000-0000-0000-0003" } },
    ]);
  });

  it("prefers ids.doi in work summary and keeps differing record doi visible", () => {
    const output = renderEnvelope(
      {
        format: "summary",
        title: "Works get W1",
        entity: "works",
      },
      {
        data: {
          id: "https://openalex.org/W1234567890",
          title: "Attention Is All You Need",
          publication_year: 2025,
          type: "preprint",
          cited_by_count: 6512,
          authorships: [{ author: { display_name: "Ashish Vaswani" } }, { author: { display_name: "Noam Shazeer" } }],
          ids: {
            doi: "https://doi.org/10.48550/arxiv.1706.03762",
          },
          doi: "https://doi.org/10.65215/2q58a426",
        },
      },
    );

    expect(output).toContain("(2025 | preprint | cited 6512)");
    expect(output).toContain("id: W1234567890");
    expect(output).toContain("authors: Ashish Vaswani, Noam Shazeer");
    expect(output).toContain("doi: https://doi.org/10.48550/arxiv.1706.03762");
    expect(output).toContain("record doi: https://doi.org/10.65215/2q58a426");
  });

  it("does not show record doi when doi values only differ by normalization", () => {
    const output = renderEnvelope(
      {
        format: "summary",
        title: "Works get W1",
        entity: "works",
      },
      {
        data: {
          title: "Normalized DOI Example",
          ids: {
            doi: "https://doi.org/10.48550/arXiv.1706.03762",
          },
          doi: "https://doi.org/10.48550/arxiv.1706.03762",
        },
      },
    );

    expect(output).toContain("doi: https://doi.org/10.48550/arXiv.1706.03762");
    expect(output).not.toContain("record doi:");
  });

  it("shows reusable short OpenAlex ids in non-work summary output", () => {
    const authorOutput = renderEnvelope(
      {
        format: "summary",
        title: "Authors search: hinton",
        entity: "authors",
      },
      {
        results: [
          {
            id: "https://openalex.org/A5070829652",
            display_name: "Geoffrey Hinton",
            works_count: 412,
            cited_by_count: 123456,
            orcid: "https://orcid.org/0000-0002-3141-5845",
          },
        ],
      },
    );

    const sourceOutput = renderEnvelope(
      {
        format: "summary",
        title: "Sources search: nature",
        entity: "sources",
      },
      {
        results: [
          {
            id: "https://openalex.org/S1983995261",
            display_name: "Nature",
            issn_l: "0028-0836",
          },
        ],
      },
    );

    expect(authorOutput).toContain("id: A5070829652");
    expect(authorOutput).toContain("orcid: https://orcid.org/0000-0002-3141-5845");
    expect(sourceOutput).toContain("id: S1983995261");
  });

  it("uses short OpenAlex ids as summary titles without duplicating the id line", () => {
    const output = renderEnvelope(
      {
        format: "summary",
        title: "Works search: id only",
        entity: "works",
      },
      {
        results: [
          {
            id: "https://openalex.org/W2741809807",
          },
        ],
      },
    );

    expect(output).toContain("- W2741809807");
    expect(output).not.toContain("https://openalex.org/W2741809807");
    expect(output).not.toContain("id: W2741809807");
  });

  it("does not label arbitrary non-OpenAlex strings as reusable ids", () => {
    const output = renderEnvelope(
      {
        format: "summary",
        title: "Authors search: fallback id",
        entity: "authors",
      },
      {
        results: [
          {
            id: "external:author-123",
            orcid: "https://orcid.org/0000-0002-3141-5845",
          },
        ],
      },
    );

    expect(output).toContain("- external:author-123");
    expect(output).not.toContain("id: external:author-123");
    expect(output).toContain("orcid: https://orcid.org/0000-0002-3141-5845");
  });
});
