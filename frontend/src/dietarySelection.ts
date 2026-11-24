// Standalone state logic so the same selection rule can be regression-tested.
export const DIETARY_OPTIONS = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "kosher", label: "Kosher" },
  { value: "gluten-free", label: "Gluten-free" },
  { value: "vegan", label: "Vegan" },
  { value: "halal", label: "Halal" },
  { value: "none", label: "None" }
] as const;
export type DietaryRestriction = typeof DIETARY_OPTIONS[number]["value"];

export function changeDietarySelection(
  current: DietaryRestriction[],
  choice: DietaryRestriction,
  checked: boolean
): DietaryRestriction[] {
  if (!checked) return current.filter(item => item !== choice);
  if (choice === "none") return ["none"];
  return [...current.filter(item => item !== "none" && item !== choice), choice];
}
