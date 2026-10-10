import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { useState, type ComponentProps } from "react";
import { ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";

type AutocompleteProps = Pick<ComponentProps<"input">, "id" | "placeholder" | "maxLength" | "required" | "disabled"> & {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
};

const sameText = new Intl.Collator(undefined, { sensitivity: "base" });

// A text input that suggests values as you type but accepts any text. Base UI's Combobox only accepts one of its
// items, so this is its Autocomplete root around shadcn's Combobox parts, which are the same primitives underneath.
// The popup stays closed when nothing new matches; an empty one would hide the rest of the form from assistive tech.
// It portals to the body, which a Radix modal dialog makes inert to the pointer, so the popup turns pointer events
// back on. Radix still counts its clicks as inside the dialog, because the portal is in the dialog's React tree.
export function Autocomplete({ value, onValueChange, suggestions, ...input }: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const { contains } = AutocompletePrimitive.useFilter();
  const typed = value.trim();
  const matches = suggestions.filter((suggestion) => contains(suggestion, typed) && sameText.compare(suggestion, typed) !== 0);

  return (
    <AutocompletePrimitive.Root
      items={suggestions}
      filteredItems={matches}
      open={open && matches.length > 0}
      onOpenChange={setOpen}
      value={value}
      onValueChange={(next) => onValueChange(next)}
    >
      <ComboboxInput {...input} showTrigger={false} className="w-full" />
      <ComboboxContent className="pointer-events-auto">
        <ComboboxList>
          {(suggestion: string) => <ComboboxItem key={suggestion} value={suggestion}>{suggestion}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </AutocompletePrimitive.Root>
  );
}
