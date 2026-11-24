// Accessible multi-select field reused by student registration and profile editing.
// "None" is a deliberate selection and cannot coexist with a restriction.
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

interface DietaryChoicesProps {
  selected: DietaryRestriction[];
  onChange: (next: DietaryRestriction[]) => void;
  disabled?: boolean;
}

export default function DietaryChoices({ selected, onChange, disabled }: DietaryChoicesProps) {
  return (
    <fieldset className="profile-dietary-options">
      <legend>Dietary restrictions</legend>
      <p className="auth-muted">Select all that apply, or choose None. Fictional demo data only.</p>
      <div className="profile-dietary-grid">
        {DIETARY_OPTIONS.map(option => (
          <label key={option.value}>
            <input type="checkbox" value={option.value}
              disabled={disabled} checked={selected.includes(option.value)}
              onChange={event => onChange(changeDietarySelection(
                selected, option.value, event.target.checked
              ))} />
            {option.label}
          </label>
        ))}
      </div>
      {selected.length === 0 && <p className="auth-muted">Please select at least one option.</p>}
    </fieldset>
  );
}
