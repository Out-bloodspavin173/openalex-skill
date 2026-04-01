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
  supportsSearch: boolean;
  supportsAutocomplete: boolean;
  supportsGroup: boolean;
  supportsRandom: boolean;
}

const entitySpecs: Record<EntityName, EntitySpec> = {
  works: {
    name: "works",
    singular: "work",
    supportsSearch: true,
    supportsAutocomplete: false,
    supportsGroup: true,
    supportsRandom: true,
  },
  authors: {
    name: "authors",
    singular: "author",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  sources: {
    name: "sources",
    singular: "source",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  institutions: {
    name: "institutions",
    singular: "institution",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  topics: {
    name: "topics",
    singular: "topic",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  publishers: {
    name: "publishers",
    singular: "publisher",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  funders: {
    name: "funders",
    singular: "funder",
    supportsSearch: true,
    supportsAutocomplete: true,
    supportsGroup: true,
    supportsRandom: true,
  },
  concepts: {
    name: "concepts",
    singular: "concept",
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
