import { Command } from "commander";
import fs from "node:fs";

import { EntityName, EntitySpec, listEntities } from "./entities.js";
import { ListOptions } from "./openalex.js";
import { OutputFormat } from "./render.js";

export interface CommonOptionConfig {
  allowSelect?: boolean;
  allowIncludeXpac?: boolean;
}

export interface GlobalOptions {
  format: OutputFormat;
  field?: string[];
}

export interface CommonListOptions extends GlobalOptions {
  filter?: string[];
  search?: string;
  sort?: string;
  select?: string[];
  sample?: string;
  seed?: string;
  page?: string;
  perPage?: string;
  cursor?: string;
  includeXpac?: boolean;
}

export function createProgram(): Command {
  const entityList = listEntities().map((spec) => spec.name).join(", ");

  return new Command()
    .name("openalex")
    .description(`Human-friendly and agent-friendly CLI for OpenAlex. Entities: ${entityList}`)
    .version(readPackageVersion(), "-V, --version", "display CLI version")
    .option("-f, --format <format>", "output format: summary|detail|json|jsonl|markdown|auto", "summary")
    .option("--field <path>", "repeatable output field path for projection, e.g. title or authorships.author.display_name", collectRepeatable, [])
    .showHelpAfterError(true)
    .showSuggestionAfterError();
}

export function readPackageVersion(): string {
  const packageUrl = new URL("../package.json", import.meta.url);
  const raw = fs.readFileSync(packageUrl, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export function addCommonListOptions(command: Command): Command {
  return addConfiguredListOptions(command, {
    allowSelect: true,
    allowIncludeXpac: false,
  });
}

export function addConfiguredListOptions(command: Command, config: CommonOptionConfig): Command {
  command
    .option("--filter <expr>", "repeatable OpenAlex filter expression", collectRepeatable, [])
    .option("--search <query>", "full text search query")
    .option("--sort <expr>", "OpenAlex sort expression")
    .option("--sample <n>", "sample size")
    .option("--seed <seed>", "sample seed")
    .option("--page <n>", "page number")
    .option("--per-page <n>", "results per page")
    .option("--cursor <cursor>", "cursor pagination token");

  if (config.allowSelect) {
    command.option("--select <field>", "repeatable selected field", collectRepeatable, []);
  }

  if (config.allowIncludeXpac) {
    command.option("--include-xpac", "include XPAC records for works queries", false);
  }

  return command;
}

export function parseListOptions(options: CommonListOptions): ListOptions {
  return {
    filter: options.filter,
    search: options.search,
    sort: options.sort,
    select: options.select,
    sample: parseOptionalInt(options.sample),
    seed: options.seed,
    page: parseOptionalInt(options.page),
    perPage: parseOptionalInt(options.perPage),
    cursor: options.cursor,
    includeXpac: options.includeXpac,
  };
}

export function supportsXpac(entity: EntityName): boolean {
  return entity === "works";
}

export function collectRepeatable(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer, received: ${value}`);
  }

  return parsed;
}

export function entityHeading(spec: EntitySpec, operation: string): string {
  return `${capitalize(spec.name)} ${operation}`;
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
