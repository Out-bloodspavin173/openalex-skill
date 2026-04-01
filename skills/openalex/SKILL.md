---
name: openalex
description: Use when the user asks about academic literature, research papers, scholarly works, authors, citations, institutions, journals, or any academic metadata. Trigger when users want to search for papers, find author profiles, track citations, discover related works, or explore academic topics. Also use when users mention DOIs, ORCIDs, h-index, publication venues, or research metrics.
---

# OpenAlex CLI Skill

Use the `openalex` CLI to retrieve academic metadata from the OpenAlex API.

## When to Use

Invoke this skill when the user needs to:
- Search for academic papers or scholarly works
- Find information about authors, institutions, or journals
- Track citations (who cited a paper, what a paper references)
- Discover related works or research topics
- Look up metadata by DOI, ORCID, or OpenAlex ID
- Analyze publication trends or research metrics

## Initial Setup

**First time using this skill?** Read [references/setup.md](references/setup.md) for installation and API key configuration.

## Prerequisites

The CLI must be built and available. Check with:
```bash
which openalex || npm exec --package=openalex-skill openalex -- --help
```

For installation, persistent API key setup, and first-run verification, see `references/setup.md`.

## Core Commands

### Entity Types
OpenAlex organizes data into 8 entity types:
- `works` - research papers, articles, preprints
- `authors` - researchers and their profiles
- `sources` - journals, conferences, repositories
- `institutions` - universities, research centers
- `topics` - research areas and subjects
- `publishers` - academic publishers
- `funders` - funding organizations
- `concepts` - (legacy) subject classifications

### Common Operations

**Search for papers:**
```bash
openalex works search "your query" --per-page 5
```

**Get specific work by ID or DOI:**
```bash
openalex works get W2741809807
openalex works get https://doi.org/10.1038/nature12373
```

**Find author:**
```bash
openalex authors search "Author Name" --per-page 3
```

**Get author by ORCID:**
```bash
openalex authors get https://orcid.org/0000-0002-3141-5845
```

**Track citations:**
```bash
# Papers that cite this work
openalex works cited-by W2741809807 --per-page 5

# Papers this work references
openalex works references W2741809807 --per-page 5

# Related works
openalex works related W2741809807 --per-page 5
```

**Filter and sort:**
```bash
openalex works list \
  --filter publication_year:2024 \
  --filter is_oa:true \
  --sort cited_by_count:desc \
  --per-page 10
```

**Autocomplete (for non-works entities):**
```bash
openalex institutions autocomplete "tsinghua"
openalex authors autocomplete "einstein"
```

**Group by field:**
```bash
openalex works group --by publication_year \
  --filter author.id:A5070829652
```

## Output Formats

The CLI defaults to `summary` format, which is concise and human-readable. Use `--format <type>` to change output style.

### Format Options

- **`summary`** (default, recommended for AI) - Concise one-line format with key metadata
  - Example: `- Attention Is All You Need (2017 | cited 6519 | OA gold | Neural Information Processing Systems)`
  - Token usage: ~2KB for 5 results
  - Each entity type has specialized formatting (works show citations, authors show h-index, etc.)

- **`detail`** - Human-readable structured output with business fields only
  - Hides transport noise (request URLs, rate-limit headers)
  - Reconstructs friendly fields like `abstract` from inverted index
  - **Inlines short projected scalar lists** for readability (e.g., authors displayed as "Alice, Bob, Charlie")
  - Good for exploring data structure without JSON verbosity

- **`json`** - Full structured payload
  - Token usage: ~40KB-268KB per query
  - Use only when you need complete data or specific nested fields

- **`jsonl`** - One JSON object per line
  - Good for streaming or line-by-line processing

- **`markdown`** - Heading + JSON block
  - Useful for documentation or reports

### Field Projection with `--field`

**Client-side projection** - fetch full payload first, then display only requested fields:

```bash
# Discover available fields first
openalex works fields

# Extract specific fields (repeatable)
openalex works get W2741809807 \
  --field title \
  --field abstract \
  --field authorships.author.display_name \
  --field doi

# detail format with field projection (authors shown inline)
openalex works search "crispr" --per-page 3 \
  --format detail \
  --field title \
  --field abstract \
  --field cited_by_count
```

**Key behaviors:**
- `--field` works with `detail`, `json`, `jsonl`, and `markdown` formats
- When requesting `abstract`, CLI reconstructs it from `abstract_inverted_index` when possible
- In `detail` format, repeated scalar paths like `authorships.author.display_name` are shown as **inline readable lists** instead of nested structures

### Server-side Selection with `--select`

**Server-side filtering** - ask OpenAlex API to return fewer fields (reduces network payload):

```bash
openalex works search "crispr" \
  --select id \
  --select title \
  --select cited_by_count
```

**Key behaviors:**
- `--select` reduces upstream payload size
- Available on `get`, `random`, `list`, `search`, `related`, `cited-by`, and `references`
- `group` does not support `--select`, but still supports `--field`
- OpenAlex only supports selecting root-level fields
- `abstract` and `abstract_inverted_index` are not selectable upstream

### Combining `--select` and `--field`

**Best practice**: Use `--select` for network efficiency, `--field` for presentation control:

```bash
# Server-side: only fetch necessary fields
# Client-side: display as curated view
openalex works search "crispr" --per-page 3 \
  --select id \
  --select title \
  --select cited_by_count \
  --field title \
  --field cited_by_count
```

**Important**: `--field abstract` and `--select` do not combine well, because OpenAlex does not let you select abstract fields upstream. If you need abstract text, avoid `--select` for that request and let the CLI reconstruct it from the full work payload.

### Format Selection Guide

**Use `summary` when:**
- Browsing or exploring results
- User wants a quick overview
- You need basic metadata (title, year, citations, authors)
- Token efficiency matters (99% reduction vs JSON)

**Use `detail` when:**
- You need structured data but JSON is too verbose
- Exploring nested fields without transport noise
- Want readable output with inline lists for repeated fields

**Use `--field` projection when:**
- You know exactly which fields you need
- Want to minimize tokens while keeping structure
- Need specific nested paths (e.g., `authorships.author.display_name`)

**Use `--select` when:**
- You want to reduce network payload from OpenAlex
- The endpoint supports official OpenAlex field selection
- Combining with `--field` for both efficiency and presentation

**Use `json` when:**
- You need the complete raw payload
- Programmatic processing of all fields required
- User explicitly asks for structured data

**Example comparison:**
```bash
# Most efficient: ~2KB for 5 results
openalex works search "LLM agents" --per-page 5

# Structured but readable with inline lists: ~10KB for 5 results
openalex works search "LLM agents" --per-page 5 --format detail

# Targeted extraction: ~5KB for 5 results
openalex works search "LLM agents" --per-page 5 \
  --format detail --field title --field abstract --field cited_by_count

# Network optimized + presentation curated
openalex works search "LLM agents" --per-page 5 \
  --select title --select cited_by_count \
  --field title --field cited_by_count

# Full payload: ~268KB for 5 results
openalex works search "LLM agents" --per-page 5 --format json
```

## Workflow Patterns

### Pattern 1: Quick Paper Search
```bash
# Start with summary to browse
openalex works search "graph neural networks" --per-page 5

# If user wants details on a specific paper, use detail format
openalex works get W2741809807 --format detail

# Or extract specific fields with inline author display
openalex works get W2741809807 \
  --format detail \
  --field title --field abstract --field authorships.author.display_name
```

### Pattern 2: Author Research
```bash
# Find author
openalex authors search "Jacob Andreas" --per-page 3

# Get author details by ORCID to resolve stable identifier
openalex authors get https://orcid.org/0000-0002-3141-5845

# Then use author.orcid filter to get their works
openalex works list --filter author.orcid:0000-0002-3141-5845 \
  --sort cited_by_count:desc --per-page 10

# Or use resolved author.id if available
openalex works list --filter author.id:A5070829652 \
  --sort cited_by_count:desc --per-page 10
```

### Pattern 3: Citation Analysis
```bash
# Get a paper
openalex works get W2741809807

# See who cited it
openalex works cited-by W2741809807 --per-page 10

# See what it references
openalex works references W2741809807 --per-page 10
```

If `cited-by` or `references` returns a 404, verify the work first with `openalex works get <id-or-doi>`.
A valid-looking `W...` id can still be missing upstream.

### Pattern 4: Topic Exploration
```bash
# Search for survey papers on a topic
openalex works search "LLM tool use survey" \
  --filter publication_year:>2023 \
  --filter type:review \
  --sort cited_by_count:desc \
  --per-page 5
```

### Pattern 5: Field Discovery and Extraction
```bash
# First, discover available fields
openalex works fields

# Then extract exactly what you need with detail format
openalex works search "retrieval augmented generation" --per-page 3 \
  --format detail \
  --field title \
  --field abstract \
  --field publication_year \
  --field cited_by_count \
  --field authorships.author.display_name
```

### Pattern 6: Handling Noisy or Empty Results

**Search too broad? Add filters:**
```bash
# Start broad
openalex works search "self-adaptive agent framework" --per-page 5

# Narrow with filters
openalex works search "self-adaptive agent framework" \
  --filter publication_year:>2022 \
  --filter type:article \
  --per-page 5
```

**Author lookup returns nothing? Verify the ID:**
```bash
# Wrong: using incorrect author.id format
openalex works list --filter authorships.author.id:A1969205030  # may fail

# Correct: use author.orcid or bare author.id
openalex works list --filter author.orcid:0000-0002-3141-5845
openalex works list --filter author.id:A5070829652
```

**Have a DOI? Use direct lookup:**
```bash
# Most reliable way to find a specific paper
openalex works get https://doi.org/10.1038/nature12373

# Preprint and repository records may show both the queried DOI and a different record DOI
openalex works get https://doi.org/10.48550/arXiv.1706.03762
```

**`--select` caveats:**
- OpenAlex `select` only supports root-level fields
- `group` and `autocomplete` do not support `select`
- `abstract` and `abstract_inverted_index` are not selectable upstream
- if you need abstract text, use `--field abstract` or fetch the full work object first

**ORCID format matters:**
```bash
# Wrong: using full ORCID URL in filter
openalex works list --filter author.orcid:https://orcid.org/0000-0002-3141-5845

# Correct: bare ORCID value
openalex works list --filter author.orcid:0000-0002-3141-5845

# But ORCID URL works for 'authors get'
openalex authors get https://orcid.org/0000-0002-3141-5845
```

## Tips

- **Default format is `summary`** - no need to specify unless you want something else
- Use `<entity> fields` command to discover available field paths before querying
- Use `--field` projection to extract specific data efficiently
- Use `--select` for network efficiency when you know which fields you need
- Combine `--select` and `--field` for optimal performance and presentation
- Use `--per-page` to control result count (default varies by endpoint)
- Filters use `:` syntax: `field:value`, `field:>value`, `field:<value`
- Sort uses `:` syntax: `field:asc` or `field:desc`
- DOIs and OpenAlex IDs are interchangeable in most commands
- **ORCID filters use bare ORCID value**, not the `https://orcid.org/` URL form
- If author work lookup returns nothing, use `author.orcid` instead of `author.id`
- If `cited-by` or `references` fails with 404, verify the work first with `works get`
- `related` follows the same work lookup rule and now accepts list-style options such as `--per-page`
- For some preprint or repository records, the queried DOI and the record DOI may differ; use `detail` or `json` when provenance matters
- Check rate limits with: `openalex rate-limit`

## Common Filters

For `works`:
- `publication_year:2024` or `publication_year:>2020`
- `is_oa:true` (open access)
- `type:article` or `type:review`
- `author.id:A5070829652`
- `author.orcid:0000-0002-3141-5845`
- `primary_location.source.id:S123456` (journal)

For `authors`:
- `last_known_institutions.id:I123456`
- `works_count:>100`

## Error Handling

If a command fails:
1. Check the entity type is correct (`works`, `authors`, etc.)
2. Verify ID format (OpenAlex IDs start with W/A/S/I/T/P/F/C)
3. Check filter syntax (use `:` not `=`)
4. Try with `--format json` to see full error details
5. If search results are empty, retry with broader keywords
6. If author lookup fails, verify ORCID format (bare value, not URL)
7. Use DOI direct lookup when you know the exact paper
8. If a work helper 404s, the identifier may be valid in shape but absent in OpenAlex
