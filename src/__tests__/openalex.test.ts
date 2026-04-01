import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "process";

import { buildCli } from "../cli.js";
import { OpenAlexClient } from "../openalex.js";
import { renderEnvelope } from "../render.js";

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

describe("CLI integration", () => {
  const fetchMock = vi.fn();
  const stdoutSpy = vi.spyOn(process.stdout, "write");

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    stdoutSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    stdoutSpy.mockReset();
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
          title: "Attention Is All You Need",
          publication_year: 2025,
          type: "preprint",
          cited_by_count: 6512,
          ids: {
            doi: "https://doi.org/10.48550/arxiv.1706.03762",
          },
          doi: "https://doi.org/10.65215/2q58a426",
        },
      },
    );

    expect(output).toContain("(2025 | preprint | cited 6512)");
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
});
