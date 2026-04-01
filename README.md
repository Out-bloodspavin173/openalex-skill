# OpenAlex Skill

Install from npm as `openalex-skill`. Run it as `openalex`.

`openalex` is a human-friendly and agent-friendly CLI for the OpenAlex API. It is designed for fast literature lookup, citation tracing, author/institution discovery, and field projection without forcing users into raw JSON by default.

Official OpenAlex resources:

- API docs: <https://docs.openalex.org>
- LLM quick reference: <https://docs.openalex.org/api-guide-for-llms>
- Official bulk-download CLI: <https://github.com/ourresearch/openalex-official>
- API key signup: <https://openalex.org/settings/api>

How this project differs from the official CLI:

- `openalex-official` is the official bulk-download tool for metadata, PDFs, and TEI XML
- `openalex` focuses on interactive API querying for humans and agents: search, get, cited-by, references, related, group, and field projection
- use the official CLI for large offline download workflows; use this project for fast lookup and agent-driven exploration

## Why Use It

- human-readable output by default
- targeted extraction with `--field`
- server-side narrowing with `--select` when OpenAlex supports it
- works, authors, sources, institutions, topics, publishers, funders, and concepts
- helper flows for `related`, `cited-by`, and `references`

## Quick Start

Install globally:

```bash
npm install -g openalex-skill
```

Set your API key:

```bash
export OPENALEX_API_KEY=your_key_here
```

Run the CLI:

```bash
openalex --help
openalex works search "llm agents" --per-page 5
openalex works get https://doi.org/10.1038/nature12373
```

Package name vs command name:

- npm package: `openalex-skill`
- executable command: `openalex`

If you are working from a local checkout before publish:

```bash
npm install
npm run build
npm exec --package=. openalex -- --help
```

## Core Examples

Search papers:

```bash
openalex works search "retrieval augmented generation" --per-page 5
```

Get a work by DOI or OpenAlex ID:

```bash
openalex works get https://doi.org/10.1038/nature12373
openalex works get W2741809807
```

Trace citations:

```bash
openalex works cited-by https://doi.org/10.1038/nature12373 --per-page 5
openalex works references W2741809807 --per-page 5
openalex works related W2741809807 --per-page 5
```

Find authors and their works:

```bash
openalex authors search "Geoffrey Hinton" --per-page 3
openalex authors get https://orcid.org/0000-0002-3141-5845
openalex works list --filter author.id:A5070829652 --per-page 5
```

Group and analyze:

```bash
openalex works group --by publication_year --filter author.id:A5070829652
openalex rate-limit
```

## Output Model

Default output is `summary`, which is optimized for both humans and agents.

Available formats:

- `summary` - concise, readable, high-signal output
- `detail` - readable structured output without transport noise
- `json` - full structured payload
- `jsonl` - one JSON object per line
- `markdown` - heading plus JSON block

Examples:

```bash
openalex works search "crispr" --per-page 3
openalex --format detail works get W2741809807
openalex --format json works search "crispr" --per-page 3
```

## Field Control

Use `--field` for client-side projection after the response arrives:

```bash
openalex works fields
openalex works get W2741809807 \
  --format detail \
  --field title \
  --field abstract \
  --field authorships.author.display_name
```

Use `--select` for server-side field selection when OpenAlex supports it:

```bash
openalex works search "crispr" \
  --select id \
  --select title \
  --select cited_by_count
```

Important `--select` caveats:

- OpenAlex only supports selecting root-level fields
- `group` and `autocomplete` do not support `--select`
- `abstract` and `abstract_inverted_index` are not selectable upstream
- if you need abstract text, prefer `--field abstract` and avoid `--select` for that request

## Agent Installation

This package is meant to be easy for agents to install and invoke.

The simplest rule is:

- install package `openalex-skill`
- run command `openalex`

### Codex CLI

```bash
npm install -g openalex-skill
openalex --help
```

### Claude Code

If the agent can run shell commands directly, the same install works:

```bash
npm install -g openalex-skill
openalex works search "llm agents" --per-page 5
```

If your environment supports repo-distributed skills:

```bash
npx skills add shiquda/openalex-skill -a claude-code
```

### OpenCode / generic local agents

```bash
npm install -g openalex-skill
openalex works get https://doi.org/10.1038/nature12373
```

If your environment supports repo-distributed skills:

```bash
npx skills add shiquda/openalex-skill -a opencode
```

### Cursor / VS Code / other agent IDEs

If the agent can access your local shell, install once and call `openalex` directly. If it prefers package execution, use:

```bash
npm exec --package=openalex-skill openalex -- --help
```

## Environment Variables

- `OPENALEX_API_KEY` - recommended for search and higher-volume use
- `OPENALEX_BASE_URL` - defaults to `https://api.openalex.org`
- `OPENALEX_MAILTO` - optional contact email

Example:

```bash
export OPENALEX_API_KEY=your_key_here
openalex works search "graph neural networks" --per-page 5
```

## Practical Notes

- DOI, OpenAlex ID, and supported external IDs can all work with `works get`
- `cited-by`, `references`, and `related` first resolve the work, then run the helper query
- if a work helper returns 404, verify the work first with `openalex works get <id-or-doi>`
- for preprint or repository records, the queried DOI and the record DOI can differ; `summary` shows both when they diverge
- `authors get` supports ORCID URLs; work filters use bare ORCID values like `author.orcid:0000-0002-3141-5845`

## Skills

This repository also includes an installable skill definition under `skills/openalex/` for skill-aware agent environments.

Top-level README stays focused on the CLI. Skill-specific operational guidance lives in `skills/openalex/SKILL.md`.

## Development

```bash
npm test
npm run typecheck
npm run build
npm run pack:dry-run
```
