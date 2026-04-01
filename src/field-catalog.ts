import { EntityName } from "./entities.js";

export interface FieldCatalogEntry {
  path: string;
  description: string;
  category: string;
}

const COMMON_FIELDS: FieldCatalogEntry[] = [
  { path: "id", description: "OpenAlex canonical identifier", category: "identity" },
  { path: "display_name", description: "Primary display label", category: "identity" },
  { path: "ids.openalex", description: "OpenAlex id inside ids object", category: "identity" },
];

const WORK_FIELDS: FieldCatalogEntry[] = [
  { path: "title", description: "Work title", category: "core" },
  { path: "doi", description: "DOI URL when available", category: "core" },
  { path: "publication_year", description: "Publication year", category: "core" },
  { path: "publication_date", description: "Publication date", category: "core" },
  { path: "type", description: "OpenAlex work type", category: "core" },
  { path: "language", description: "Language code", category: "core" },
  { path: "abstract", description: "Friendly abstract text reconstructed when possible", category: "content" },
  { path: "authorships.author.display_name", description: "Author display names", category: "authors" },
  { path: "authorships.author.orcid", description: "Author ORCID values", category: "authors" },
  { path: "authorships.institutions.display_name", description: "Author institution names", category: "authors" },
  { path: "primary_location.source.display_name", description: "Primary venue/source name", category: "venue" },
  { path: "primary_location.landing_page_url", description: "Primary landing page URL", category: "venue" },
  { path: "primary_location.pdf_url", description: "Primary PDF URL", category: "venue" },
  { path: "open_access.is_oa", description: "Whether the work is open access", category: "access" },
  { path: "open_access.oa_status", description: "Open access status", category: "access" },
  { path: "open_access.oa_url", description: "Open access URL", category: "access" },
  { path: "cited_by_count", description: "Citation count", category: "impact" },
  { path: "fwci", description: "Field-weighted citation impact", category: "impact" },
  { path: "primary_topic.display_name", description: "Primary topic label", category: "topics" },
  { path: "topics.display_name", description: "Topic labels", category: "topics" },
  { path: "keywords.display_name", description: "Keyword labels", category: "topics" },
  { path: "concepts.display_name", description: "Concept labels", category: "topics" },
  { path: "best_oa_location.landing_page_url", description: "Best OA landing page URL", category: "access" },
  { path: "referenced_works", description: "Referenced work ids", category: "relations" },
  { path: "related_works", description: "Related work ids", category: "relations" },
  { path: "counts_by_year", description: "Citation counts by year", category: "impact" },
];

const AUTHOR_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Author name", category: "core" },
  { path: "orcid", description: "Author ORCID", category: "identity" },
  { path: "works_count", description: "Number of indexed works", category: "impact" },
  { path: "cited_by_count", description: "Total citation count", category: "impact" },
  { path: "summary_stats.h_index", description: "H-index", category: "impact" },
  { path: "summary_stats.i10_index", description: "i10-index", category: "impact" },
  { path: "last_known_institutions.display_name", description: "Recent institution names", category: "affiliations" },
  { path: "x_concepts.display_name", description: "Associated concept labels", category: "topics" },
];

const SOURCE_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Source name", category: "core" },
  { path: "issn_l", description: "Linking ISSN", category: "identity" },
  { path: "issn", description: "ISSN values", category: "identity" },
  { path: "type", description: "Source type", category: "core" },
  { path: "is_oa", description: "Whether source is open access", category: "access" },
  { path: "is_in_doaj", description: "Whether source is indexed in DOAJ", category: "access" },
  { path: "works_count", description: "Indexed work count", category: "impact" },
  { path: "cited_by_count", description: "Citation count for source", category: "impact" },
  { path: "summary_stats.2yr_mean_citedness", description: "Two-year mean citedness", category: "impact" },
  { path: "host_organization_name", description: "Host organization name", category: "publisher" },
];

const INSTITUTION_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Institution name", category: "core" },
  { path: "country_code", description: "Country code", category: "location" },
  { path: "type", description: "Institution type", category: "core" },
  { path: "ror", description: "ROR identifier", category: "identity" },
  { path: "works_count", description: "Indexed work count", category: "impact" },
  { path: "cited_by_count", description: "Citation count", category: "impact" },
  { path: "summary_stats.h_index", description: "Institution H-index", category: "impact" },
  { path: "associated_institutions.display_name", description: "Related institution names", category: "relations" },
];

const TOPIC_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Topic label", category: "core" },
  { path: "description", description: "Topic description", category: "core" },
  { path: "keywords", description: "Topic keywords", category: "topics" },
  { path: "works_count", description: "Indexed work count", category: "impact" },
  { path: "subfield.display_name", description: "Subfield label", category: "taxonomy" },
  { path: "field.display_name", description: "Field label", category: "taxonomy" },
  { path: "domain.display_name", description: "Domain label", category: "taxonomy" },
];

const PUBLISHER_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Publisher name", category: "core" },
  { path: "alternate_titles", description: "Alternate publisher names", category: "identity" },
  { path: "hierarchy_level", description: "Publisher hierarchy level", category: "core" },
  { path: "works_count", description: "Indexed work count", category: "impact" },
  { path: "cited_by_count", description: "Citation count", category: "impact" },
  { path: "sources_api_url", description: "API URL for related sources", category: "relations" },
];

const FUNDER_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Funder name", category: "core" },
  { path: "alternate_titles", description: "Alternate funder names", category: "identity" },
  { path: "country_code", description: "Country code", category: "location" },
  { path: "grants_count", description: "Grant count", category: "impact" },
  { path: "works_count", description: "Funded work count", category: "impact" },
  { path: "cited_by_count", description: "Citation count", category: "impact" },
  { path: "summary_stats.h_index", description: "Funder H-index", category: "impact" },
];

const CONCEPT_FIELDS: FieldCatalogEntry[] = [
  { path: "display_name", description: "Concept label", category: "core" },
  { path: "description", description: "Concept description", category: "core" },
  { path: "level", description: "Concept hierarchy level", category: "taxonomy" },
  { path: "works_count", description: "Indexed work count", category: "impact" },
  { path: "cited_by_count", description: "Citation count", category: "impact" },
  { path: "ancestors.display_name", description: "Ancestor concept names", category: "taxonomy" },
  { path: "related_concepts.display_name", description: "Related concept names", category: "relations" },
];

const ENTITY_FIELDS: Record<EntityName, FieldCatalogEntry[]> = {
  works: [...COMMON_FIELDS, ...WORK_FIELDS],
  authors: [...COMMON_FIELDS, ...AUTHOR_FIELDS],
  sources: [...COMMON_FIELDS, ...SOURCE_FIELDS],
  institutions: [...COMMON_FIELDS, ...INSTITUTION_FIELDS],
  topics: [...COMMON_FIELDS, ...TOPIC_FIELDS],
  publishers: [...COMMON_FIELDS, ...PUBLISHER_FIELDS],
  funders: [...COMMON_FIELDS, ...FUNDER_FIELDS],
  concepts: [...COMMON_FIELDS, ...CONCEPT_FIELDS],
};

export function getFieldCatalog(entity: EntityName): FieldCatalogEntry[] {
  return ENTITY_FIELDS[entity];
}
