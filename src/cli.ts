import { Command } from "commander";

import {
  ConfigKey,
  getConfig,
  getConfigPath,
  maskSecret,
  readStoredConfig,
  unsetStoredConfig,
  updateStoredConfig,
} from "./config.js";
import {
  addConfiguredListOptions,
  addInheritedGlobalOptionHelp,
  CommonListOptions,
  createProgram,
  entityHeading,
  GlobalOptions,
  parseListOptions,
  supportsXpac,
} from "./command-helpers.js";
import { createDownloadProgressReporter, downloadWorkFile } from "./download.js";
import { EntitySpec, listEntities } from "./entities.js";
import { getFieldCatalog } from "./field-catalog.js";
import { ApiEnvelope, OpenAlexClient } from "./openalex.js";
import { renderEnvelope, resolveOutputFormat } from "./render.js";

export function buildCli(): Command {
  const program = createProgram();
  const client = (): OpenAlexClient => new OpenAlexClient(getConfig());

  const configCommand = program.command("config").description("Read and write persistent CLI configuration.");

  configCommand.action(function () {
    writeConfigSummary();
  });

  configCommand
    .command("show")
    .description("Show the effective and stored configuration.")
    .action(function () {
      writeConfigSummary();
    });

  configCommand
    .command("path")
    .description("Print the persistent config file path.")
    .action(function () {
      process.stdout.write(`${getConfigPath()}\n`);
    });

  program
    .command("version")
    .description("Show the installed CLI version.")
    .action(function () {
      process.stdout.write(`${program.version()}\n`);
    });

  configCommand
    .command("set")
    .argument("<key>", "apiKey|api-key | baseUrl|base-url | mailto")
    .argument("<value>", "value to persist")
    .description("Persist a configuration value to the user config file.")
    .action(function (key: string, value: string) {
      const normalized = parseConfigKey(key);
      updateStoredConfig(normalized, value);
      const displayValue = normalized === "apiKey" ? maskSecret(value) : value;
      process.stdout.write(`Saved ${normalized}=${displayValue}\n`);
    });

  configCommand
    .command("unset")
    .argument("<key>", "apiKey|api-key | baseUrl|base-url | mailto")
    .description("Remove a persisted configuration value from the user config file.")
    .action(function (key: string) {
      const normalized = parseConfigKey(key);
      unsetStoredConfig(normalized);
      process.stdout.write(`Removed ${normalized}\n`);
    });

  program
    .command("rate-limit")
    .description("Show current OpenAlex credit status for the configured API key.")
    .action(async function () {
      const payload = await client().getRateLimit();
      writeOutput(readGlobalOptions(this), "Rate limit status", payload);
    });

  for (const spec of listEntities()) {
    program.addCommand(buildEntityCommand(spec, client));
  }

  return program;
}

function parseConfigKey(value: string): ConfigKey {
  if (value === "apiKey" || value === "api-key") {
    return "apiKey";
  }

  if (value === "baseUrl" || value === "base-url") {
    return "baseUrl";
  }

  if (value === "mailto") {
    return "mailto";
  }

  throw new Error(`Unsupported config key: ${value}. Use apiKey/api-key, baseUrl/base-url, or mailto.`);
}

function writeConfigSummary(): void {
  const stored = readStoredConfig();
  const effective = getConfig();
  process.stdout.write(
    [
      "OpenAlex config",
      `path: ${getConfigPath()}`,
      `stored.apiKey: ${maskSecret(stored.apiKey) ?? "<unset>"}`,
      `stored.baseUrl: ${stored.baseUrl ?? "<unset>"}`,
      `stored.mailto: ${stored.mailto ?? "<unset>"}`,
      `effective.apiKey: ${maskSecret(effective.apiKey) ?? "<unset>"}`,
      `effective.baseUrl: ${effective.baseUrl}`,
      `effective.mailto: ${effective.mailto ?? "<unset>"}`,
    ].join("\n") + "\n",
  );
}

function buildEntityCommand(spec: EntitySpec, getClient: () => OpenAlexClient): Command {
  const entity = new Command(spec.name).description(spec.description);

  addInheritedGlobalOptionHelp(
    entity
      .command("fields")
      .description(`List curated field paths for ${spec.name} output projection.`)
      .action(async function () {
        writeFieldCatalog(readGlobalOptions(this), entityHeading(spec, "fields"), getFieldCatalog(spec.name));
      }),
  );

  addInheritedGlobalOptionHelp(addConfiguredListOptions(
    entity
      .command("list")
      .description(`List ${spec.name} with filters, search, paging, and field selection.`)
      .action(async function (options: CommonListOptions) {
        const payload = await getClient().list(spec.name, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, "list"), payload, spec.name);
      }),
    {
      allowSelect: true,
      allowIncludeXpac: supportsXpac(spec.name),
      allowSearch: true,
    },
  ));

  addInheritedGlobalOptionHelp(
    entity
      .command("get")
      .argument("<id>", `OpenAlex ${spec.singular} id or supported external id`)
      .option("--select <field>", "repeatable selected field", (value: string, previous: string[]) => {
        previous.push(value);
        return previous;
      }, [])
      .description(`Get a single ${spec.singular}.`)
      .action(async function (id: string, options: GlobalOptions & { select?: string[] }) {
        const payload = await getClient().get(spec.name, id, options.select);
        writeOutput(readGlobalOptions(this), entityHeading(spec, `get ${id}`), payload, spec.name);
      }),
  );

  if (spec.supportsSearch) {
    addInheritedGlobalOptionHelp(addConfiguredListOptions(
      entity
        .command("search")
        .argument("<query>", `Search query for ${spec.name}`)
        .description(`Search ${spec.name}.`)
        .action(async function (query: string, options: CommonListOptions) {
          const listOptions = parseListOptions(options);
          const exactLookupId = resolveExactLookupIdentifier(spec.name, query);
          if (exactLookupId) {
            const exactMatch = await tryExactLookup(getClient(), spec.name, exactLookupId, listOptions.select);
            if (exactMatch) {
              writeOutput(readGlobalOptions(this), entityHeading(spec, `search: ${query}`), wrapSingleRecordAsList(exactMatch), spec.name);
              return;
            }
          }

          const payload = await getClient().list(spec.name, {
            ...listOptions,
            search: query,
          });
          writeOutput(readGlobalOptions(this), entityHeading(spec, `search: ${query}`), payload, spec.name);
        }),
        {
          allowSelect: true,
          allowIncludeXpac: supportsXpac(spec.name),
          allowSearch: false,
        },
      ));
  }

  if (spec.supportsGroup) {
    addInheritedGlobalOptionHelp(addConfiguredListOptions(
      entity
        .command("group")
        .requiredOption("--by <field>", "group_by field")
        .description(`Group ${spec.name} by a field.`)
        .action(async function (options: CommonListOptions & { by: string }) {
          const payload = await getClient().group(spec.name, options.by, parseListOptions(options));
          writeOutput(readGlobalOptions(this), entityHeading(spec, `group by ${options.by}`), payload, spec.name);
        }),
        {
          allowSelect: false,
          allowIncludeXpac: supportsXpac(spec.name),
          allowSearch: true,
        },
      ));
  }

  if (spec.supportsAutocomplete) {
    addInheritedGlobalOptionHelp(
      entity
        .command("autocomplete")
        .argument("<query>", `Autocomplete ${spec.name}`)
        .description(`Autocomplete names for ${spec.name}.`)
          .action(async function (query: string, options: GlobalOptions) {
            const payload = await getClient().autocomplete(spec.name, query);
            void options;
            writeOutput(readGlobalOptions(this), entityHeading(spec, `autocomplete: ${query}`), payload, spec.name);
          }),
    );
  }

  if (spec.supportsRandom) {
    addInheritedGlobalOptionHelp(
      entity
        .command("random")
        .option("--select <field>", "repeatable selected field", (value: string, previous: string[]) => {
          previous.push(value);
          return previous;
        }, [])
        .description(`Fetch a random ${spec.singular}.`)
        .action(async function (options: GlobalOptions & { select?: string[] }) {
          const payload = await getClient().random(spec.name, options.select);
          writeOutput(readGlobalOptions(this), entityHeading(spec, "random"), payload, spec.name);
        }),
    );
  }

  if (spec.name === "works") {
    addInheritedGlobalOptionHelp(
      entity
        .command("download")
        .argument("<id>", "OpenAlex work id or DOI")
        .option("-o, --output <file>", "output file path; defaults to a DOI/OpenAlex-based filename in the current directory")
        .option("--overwrite", "overwrite an existing output file", false)
        .description("Download the best available direct full-text file for a work using OpenAlex metadata URLs.")
        .action(async function (id: string, options: GlobalOptions & { output?: string; overwrite?: boolean }) {
          const result = await downloadWorkFile(getClient(), id, {
            output: options.output,
            overwrite: options.overwrite,
            onProgress: createDownloadProgressReporter(),
          });

          const lines = [
            `Downloaded work full text: ${result.workId}`,
            `saved: ${result.filePath}`,
            `source: ${result.sourceField}`,
            `url: ${result.finalUrl}`,
            `bytes: ${result.bytes}`,
          ];

          if (result.title) {
            lines.splice(1, 0, `title: ${result.title}`);
          }

          if (result.contentType) {
            lines.push(`content-type: ${result.contentType}`);
          }

          process.stdout.write(`${lines.join("\n")}\n`);
        }),
    );

    const relatedCommand = entity
      .command("related")
      .argument("<id>", "OpenAlex work id or DOI")
      .description("Fetch related works using the work's related_works field.")
      .action(async function (id: string, options: CommonListOptions) {
        const payload = await getClient().getRelatedWorks(id, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, `related: ${id}`), payload, spec.name);
      });

    addInheritedGlobalOptionHelp(addConfiguredListOptions(relatedCommand, {
      allowSelect: true,
      allowIncludeXpac: true,
      allowSearch: true,
    }));

    const citedByCommand = entity
      .command("cited-by")
      .argument("<id>", "OpenAlex work id or DOI")
      .description("Fetch works that cite the given work.")
      .action(async function (id: string, options: CommonListOptions) {
        const payload = await getClient().getCitedByWorks(id, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, `cited by: ${id}`), payload, spec.name);
      });

    addInheritedGlobalOptionHelp(addConfiguredListOptions(citedByCommand, {
      allowSelect: true,
      allowIncludeXpac: true,
      allowSearch: true,
    }));

    const referencesCommand = entity
      .command("references")
      .argument("<id>", "OpenAlex work id or DOI")
      .description("Fetch works referenced by the given work.")
      .action(async function (id: string, options: CommonListOptions) {
        const payload = await getClient().getReferencedWorks(id, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, `references: ${id}`), payload, spec.name);
      });

    addInheritedGlobalOptionHelp(addConfiguredListOptions(referencesCommand, {
      allowSelect: true,
      allowIncludeXpac: true,
      allowSearch: true,
    }));
  }

  return entity;
}

function writeOutput(options: GlobalOptions, title: string, payload: unknown, entity?: EntitySpec["name"]): void {
  process.stdout.write(renderEnvelope({ format: options.format, title, fields: options.field, entity }, payload));
}

function readGlobalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

function wrapSingleRecordAsList(payload: ApiEnvelope<Record<string, unknown>>): ApiEnvelope<Record<string, unknown>> {
  return {
    rateLimit: payload.rateLimit,
    requestUrl: payload.requestUrl,
    meta: { count: 1, page: 1, per_page: 1 },
    results: payload.data ? [payload.data] : [],
  };
}

async function tryExactLookup(
  client: OpenAlexClient,
  entity: EntitySpec["name"],
  identifier: string,
  select?: string[],
): Promise<ApiEnvelope<Record<string, unknown>> | undefined> {
  try {
    return await client.get(entity, identifier, select);
  } catch (error) {
    if (error instanceof Error && /\b404\b/.test(error.message)) {
      return undefined;
    }

    throw error;
  }
}

function resolveExactLookupIdentifier(entity: EntitySpec["name"], query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  const openAlexPrefix = getEntityIdPrefix(entity);
  const openAlexMatch = trimmed.match(/^https?:\/\/openalex\.org\/([A-Z]\d+)\/?$/i) ?? trimmed.match(/^([A-Z]\d+)$/i);
  if (openAlexMatch) {
    const shortId = openAlexMatch[1].toUpperCase();
    return shortId.startsWith(openAlexPrefix) ? shortId : undefined;
  }

  if (entity === "works") {
    const doi = normalizeDoiIdentifier(trimmed);
    if (doi) {
      return doi;
    }
  }

  if (entity === "authors") {
    const orcid = normalizeOrcidIdentifier(trimmed);
    if (orcid) {
      return orcid;
    }
  }

  return undefined;
}

function getEntityIdPrefix(entity: EntitySpec["name"]): string {
  switch (entity) {
    case "works":
      return "W";
    case "authors":
      return "A";
    case "sources":
      return "S";
    case "institutions":
      return "I";
    case "topics":
      return "T";
    case "publishers":
      return "P";
    case "funders":
      return "F";
    case "concepts":
      return "C";
  }
}

function normalizeDoiIdentifier(query: string): string | undefined {
  const bareDoiMatch = query.match(/^10\.\d{4,9}\/\S+$/i);
  if (bareDoiMatch) {
    return `https://doi.org/${bareDoiMatch[0]}`;
  }

  const doiUrlMatch = query.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i);
  if (doiUrlMatch) {
    return `https://doi.org/${doiUrlMatch[1]}`;
  }

  const doiPrefixedMatch = query.match(/^doi:\s*(10\.\d{4,9}\/\S+)$/i);
  if (doiPrefixedMatch) {
    return `https://doi.org/${doiPrefixedMatch[1]}`;
  }

  return undefined;
}

function normalizeOrcidIdentifier(query: string): string | undefined {
  const bareOrcidMatch = query.match(/^(\d{4}-\d{4}-\d{4}-[\dX]{4})$/i);
  if (bareOrcidMatch) {
    return `https://orcid.org/${bareOrcidMatch[1].toUpperCase()}`;
  }

  const orcidUrlMatch = query.match(/^https?:\/\/orcid\.org\/(\d{4}-\d{4}-\d{4}-[\dX]{4})\/?$/i);
  if (orcidUrlMatch) {
    return `https://orcid.org/${orcidUrlMatch[1].toUpperCase()}`;
  }

  return undefined;
}

function writeFieldCatalog(
  options: GlobalOptions,
  title: string,
  fields: Array<{ path: string; description: string; category: string }>,
): void {
  const format = resolveOutputFormat(options.format);

  if (format === "json" || format === "jsonl" || format === "markdown") {
    process.stdout.write(renderEnvelope({ format, title }, { data: { fields } }));
    return;
  }

  const grouped = new Map<string, Array<{ path: string; description: string }>>();
  for (const field of fields) {
    const bucket = grouped.get(field.category) ?? [];
    bucket.push({ path: field.path, description: field.description });
    grouped.set(field.category, bucket);
  }

  const lines = [title, "Use these paths with --field <path>. Curated paths stay stable even if raw payloads are noisy."];
  for (const [category, entries] of grouped.entries()) {
    lines.push("");
    lines.push(`${category}:`);
    for (const entry of entries) {
      lines.push(`- ${entry.path} (${entry.description})`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}
