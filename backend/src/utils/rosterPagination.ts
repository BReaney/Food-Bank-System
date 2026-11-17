import type { Request } from "express";

/**
 * Parse untrusted search and pagination query parameters.
 * Staff lists are always bounded; an oversized request cannot bypass LIMIT.
 */
export interface RosterQuery {
  search: string;
  limit: number;
  offset: number;
}

export interface PageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

function parseWholeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed : null;
}

export function parseRosterQuery(query: Request["query"]): RosterQuery | null {
  const limit = parseWholeNumber(query.limit, 25, 1, 100);
  const offset = parseWholeNumber(query.offset, 0, 0, 1_000_000);
  const rawSearch = query.search ?? "";

  if (limit === null || offset === null || typeof rawSearch !== "string") {
    return null;
  }
  const search = rawSearch.trim();
  if (search.length > 100) return null;
  return { limit, offset, search };
}

export function buildPageInfo(
  request: RosterQuery,
  total: number,
  returnedCount: number
): PageInfo {
  return {
    limit: request.limit,
    offset: request.offset,
    total,
    hasNext: request.offset + returnedCount < total,
    hasPrevious: request.offset > 0
  };
}
