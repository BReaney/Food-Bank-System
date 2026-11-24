// Keep input validation centralized for registration and profile edits.
// Dietary data is a self-reported fictional demo preference; never audit its values.
export const STUDENT_DESIGNATIONS = ["domestic", "international"] as const;
export type StudentDesignation = typeof STUDENT_DESIGNATIONS[number];

export const DIETARY_OPTIONS = [
  "vegetarian", "kosher", "gluten-free", "vegan", "halal", "none"
] as const;
export type DietaryRestriction = typeof DIETARY_OPTIONS[number];

export function validStudentDesignation(value: unknown): value is StudentDesignation {
  return typeof value === "string" &&
    STUDENT_DESIGNATIONS.some(choice => choice === value);
}

export function validDietaryRestrictions(value: unknown): value is DietaryRestriction[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return false;
  if (value.some(choice => typeof choice !== "string" ||
      !DIETARY_OPTIONS.some(option => option === choice))) return false;
  if (new Set(value).size !== value.length) return false;
  return !value.includes("none") || value.length === 1;
}
