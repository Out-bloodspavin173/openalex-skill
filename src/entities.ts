export type EntityName =
  | "works"
  | "authors"
  | "sources"
  | "institutions"
  | "topics"
  | "publishers"
  | "funders"
  | "concepts";

export interface EntitySpec {
  name: EntityName;
  singular: string;
  description: string;
  supportsSearch: boolean;
  supportsAutocomplete: boolean;
  supportsGroup: boolean;
  supportsRandom: boolean;
}

const entitySpecs: Record<EntityName, EntitySpec> = {
  works: {
    name: "works",
    singular: "work",
    description: "Search papers, look up DOIs, download open-access full text, and trace citations or related works.",
    supportsSearch: true,
    supportsAutocomplete: false,
    supportsGroup: true,
    supportsRandom: true,
  },
  authors: {
    name: "authors",
    singular: "author",
    description: "Find researchers, ORCID profiles, affiliations, and author-level metrics.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  sources: {
    name: "sources",
    singular: "source",
    description: "Explore journals, conferences, repositories, and venue metadata.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  institutions: {
    name: "institutions",
    singular: "institution",
    description: "Look up universities, labs, and institution-level research output.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  topics: {
    name: "topics",
    singular: "topic",
    description: "Browse OpenAlex topic clusters and subject-level research areas.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  publishers: {
    name: "publishers",
    singular: "publisher",
    description: "Inspect publisher metadata and publication volume across venues.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  funders: {
    name: "funders",
    singular: "funder",
    description: "Find funding organizations and analyze funded research output.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  concepts: {
    name: "concepts",
    singular: "concept",
    description: "Query legacy OpenAlex concepts and concept-level aggregates.",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
};

export function listEntities(): EntitySpec[] {
  return Object.values(entitySpecs);
}

export function getEntitySpec(name: string): EntitySpec {
  const spec = entitySpecs[name as EntityName];
  if (!spec) {
    throw new Error(`Unsupported entity: ${name}`);
  }

  return spec;
}
