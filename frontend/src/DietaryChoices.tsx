import { DIETARY_OPTIONS, changeDietarySelection } from "./dietarySelection";
import type { DietaryRestriction } from "./dietarySelection";
export type { DietaryRestriction } from "./dietarySelection";

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
