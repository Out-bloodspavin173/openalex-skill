import { Command } from "commander";

import { getConfig } from "./config.js";
import {
  addConfiguredListOptions,
  CommonListOptions,
  createProgram,
  entityHeading,
  GlobalOptions,
  parseListOptions,
  supportsXpac,
} from "./command-helpers.js";
import { EntitySpec, listEntities } from "./entities.js";
import { getFieldCatalog } from "./field-catalog.js";
import { OpenAlexClient } from "./openalex.js";
import { renderEnvelope, resolveOutputFormat } from "./render.js";

export function buildCli(): Command {
  const program = createProgram();
  const client = new OpenAlexClient(getConfig());

  program
    .command("rate-limit")
    .description("Show current OpenAlex credit status for the configured API key.")
    .action(async function () {
      const payload = await client.getRateLimit();
      writeOutput(readGlobalOptions(this), "Rate limit status", payload);
    });

  for (const spec of listEntities()) {
    program.addCommand(buildEntityCommand(spec, client));
  }

  return program;
}

function buildEntityCommand(spec: EntitySpec, client: OpenAlexClient): Command {
  const entity = new Command(spec.name).description(`Operate on OpenAlex ${spec.name}.`);

  entity
    .command("fields")
    .description(`List curated field paths for ${spec.name} output projection.`)
    .action(async function () {
      writeFieldCatalog(readGlobalOptions(this), entityHeading(spec, "fields"), getFieldCatalog(spec.name));
    });

  addConfiguredListOptions(
    entity
      .command("list")
      .description(`List ${spec.name} with filters, search, paging, and field selection.`)
      .action(async function (options: CommonListOptions) {
        const payload = await client.list(spec.name, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, "list"), payload, spec.name);
      }),
    {
      allowSelect: true,
      allowIncludeXpac: supportsXpac(spec.name),
    },
  );

  entity
    .command("get")
    .argument("<id>", `OpenAlex ${spec.singular} id or supported external id`)
    .option("--select <field>", "repeatable selected field", (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    }, [])
    .description(`Get a single ${spec.singular}.`)
    .action(async function (id: string, options: GlobalOptions & { select?: string[] }) {
      const payload = await client.get(spec.name, id, options.select);
      writeOutput(readGlobalOptions(this), entityHeading(spec, `get ${id}`), payload, spec.name);
    });

  if (spec.supportsSearch) {
    addConfiguredListOptions(
      entity
        .command("search")
        .argument("<query>", `Search query for ${spec.name}`)
        .description(`Search ${spec.name}.`)
        .action(async function (query: string, options: CommonListOptions) {
          const payload = await client.list(spec.name, {
            ...parseListOptions(options),
            search: query,
          });
          writeOutput(readGlobalOptions(this), entityHeading(spec, `search: ${query}`), payload, spec.name);
        }),
      {
        allowSelect: true,
        allowIncludeXpac: supportsXpac(spec.name),
      },
    );
  }

  if (spec.supportsGroup) {
    addConfiguredListOptions(
      entity
        .command("group")
        .requiredOption("--by <field>", "group_by field")
        .description(`Group ${spec.name} by a field.`)
        .action(async function (options: CommonListOptions & { by: string }) {
          const payload = await client.group(spec.name, options.by, parseListOptions(options));
          writeOutput(readGlobalOptions(this), entityHeading(spec, `group by ${options.by}`), payload, spec.name);
        }),
      {
        allowSelect: false,
        allowIncludeXpac: supportsXpac(spec.name),
      },
    );
  }

  if (spec.supportsAutocomplete) {
    entity
      .command("autocomplete")
      .argument("<query>", `Autocomplete ${spec.name}`)
      .description(`Autocomplete names for ${spec.name}.`)
        .action(async function (query: string, options: GlobalOptions) {
          const payload = await client.autocomplete(spec.name, query);
          void options;
          writeOutput(readGlobalOptions(this), entityHeading(spec, `autocomplete: ${query}`), payload, spec.name);
        });
  }

  if (spec.supportsRandom) {
    entity
      .command("random")
      .option("--select <field>", "repeatable selected field", (value: string, previous: string[]) => {
        previous.push(value);
        return previous;
      }, [])
      .description(`Fetch a random ${spec.singular}.`)
      .action(async function (options: GlobalOptions & { select?: string[] }) {
        const payload = await client.random(spec.name, options.select);
        writeOutput(readGlobalOptions(this), entityHeading(spec, "random"), payload, spec.name);
      });
  }

  if (spec.name === "works") {
    const relatedCommand = entity
      .command("related")
      .argument("<id>", "OpenAlex work id or DOI")
      .description("Fetch related works using the work's related_works field.")
      .action(async function (id: string, options: CommonListOptions) {
        const payload = await client.getRelatedWorks(id, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, `related: ${id}`), payload, spec.name);
      });

    addConfiguredListOptions(relatedCommand, {
      allowSelect: true,
      allowIncludeXpac: true,
    });

    const citedByCommand = entity
      .command("cited-by")
      .argument("<id>", "OpenAlex work id or DOI")
      .description("Fetch works that cite the given work.")
      .action(async function (id: string, options: CommonListOptions) {
        const payload = await client.getCitedByWorks(id, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, `cited by: ${id}`), payload, spec.name);
      });

    addConfiguredListOptions(citedByCommand, {
      allowSelect: true,
      allowIncludeXpac: true,
    });

    const referencesCommand = entity
      .command("references")
      .argument("<id>", "OpenAlex work id or DOI")
      .description("Fetch works referenced by the given work.")
      .action(async function (id: string, options: CommonListOptions) {
        const payload = await client.getReferencedWorks(id, parseListOptions(options));
        writeOutput(readGlobalOptions(this), entityHeading(spec, `references: ${id}`), payload, spec.name);
      });

    addConfiguredListOptions(referencesCommand, {
      allowSelect: true,
      allowIncludeXpac: true,
    });
  }

  return entity;
}

function writeOutput(options: GlobalOptions, title: string, payload: unknown, entity?: EntitySpec["name"]): void {
  process.stdout.write(renderEnvelope({ format: options.format, title, fields: options.field, entity }, payload));
}

function readGlobalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
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
