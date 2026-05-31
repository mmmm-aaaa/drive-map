/** Queries that models often echo from prompt templates instead of a real place. */
const PLACEHOLDER_QUERIES = new Set([
  "地名や施設名",
  "地名・施設名",
  "地名または施設名",
  "具体名",
  "具体的地名",
  "地名",
  "施設名"
]);

function normalizeQueryForPlaceholderCheck(query: string): string {
  return query.replace(/\s+/gu, "").trim();
}

export function isPlaceholderDestinationQuery(query: string): boolean {
  const n = normalizeQueryForPlaceholderCheck(query);
  if (!n) {
    return false;
  }
  return PLACEHOLDER_QUERIES.has(n);
}
