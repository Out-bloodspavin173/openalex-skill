export interface CliConfig {
  apiKey?: string;
  baseUrl: string;
  mailto?: string;
}

export function getConfig(): CliConfig {
  return {
    apiKey: process.env.OPENALEX_API_KEY,
    baseUrl: process.env.OPENALEX_BASE_URL ?? "https://api.openalex.org",
    mailto: process.env.OPENALEX_MAILTO,
  };
}

export function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
