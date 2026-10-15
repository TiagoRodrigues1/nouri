import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanBarcode, Search } from "lucide-react";
import { styles } from "./form-styles";
import { BarcodeScanner } from "./barcode-scanner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ManualFoodForm } from "./manual-food-form";
import { ApiError, lookupBarcode, searchFoods, type Candidate, type LabelFood, type SearchResult } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { portionFood, type FoodPortion, type FoodSource } from "./lib/food-portion";
import { draftRow } from "./lib/saved-meals";
import type { FoodSelection } from "./lib/food-selection";
import { SelectableResult } from "./selected-foods";
import { isBarcode, isUserAdded, recordedFood } from "../../src/food/contract";

// A food the tab offers. Its basis is 100 g or ml, which previews any amount. Ciqual foods log by reference,
// so the server measures them; a scanned product or community food logs as the scaled label, carrying its reference.
export type Choice = {
  key: string;
  source: FoodSource;
  brand: string | null;
  serving: LabelFood["serving"];
};

function ciqualChoice(candidate: Extract<Candidate, { kind: "generic" }>): Choice {
  return {
    key: `ciqual:${candidate.ref.id}`,
    source: { kind: "catalog", basis: { name: candidate.name, quantity: { amount: 100, unit: "g" }, nutrients: candidate.nutrients, catalogRef: candidate.ref } },
    brand: null,
    serving: null,
  };
}

// The contract permits a label without a reference, so its position identifies it within one result set.
function labelChoice(product: LabelFood, fallbackKey: string): Choice {
  const ref = product.food.catalogRef;

  return {
    key: ref ? `${ref.provider}:${ref.id}` : fallbackKey,
    source: { kind: "label", basis: product.food },
    brand: product.brand,
    serving: product.serving,
  };
}

// A barcode finds one product and a name searches Nouri's foods and Ciqual; either way the tab shows choices and their sources.
export async function findChoices(term: string): Promise<{ choices: Choice[]; attribution: SearchResult["attribution"] }> {
  if (isBarcode(term)) {
    const { product, attribution } = await lookupBarcode(term);

    return { choices: [labelChoice(product, `barcode:${product.barcode}`)], attribution };
  }

  const { items, attribution } = await searchFoods(term);

  return { choices: items.map((item, index) => item.kind === "community" ? labelChoice(item, `label:${index}`) : ciqualChoice(item)), attribution };
}

// Only an outage is worth asking again; a missing product stays missing.
export const retryOutage = (failures: number, error: Error) => failures < 1 && error instanceof ApiError && error.status === 502;

// A food ticked into the selection starts at one serving, or 100 g or ml.
function tick(selection: FoodSelection, key: string, { submitted, preview }: FoodPortion) {
  selection.toggle({ ...draftRow({ kind: "submitted", food: submitted }, preview), key });
}

// Food search and barcode lookup, each result ticked into the selection. A barcode nobody knows can be added from
// its label.
export function SearchFoodPicker({ selection }: { selection: FoodSelection }) {
  const [draft, setDraft] = useState("");
  const [term, setTerm] = useState("");
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);

  // Digits are a barcode, never a name, so a mistyped code says so instead of finding no foods.
  const badBarcode = /^\d+$/.test(term) && !isBarcode(term);

  const query = useQuery({
    queryKey: ["foods", term],
    queryFn: () => findChoices(term),
    enabled: !badBarcode && term.length >= 2,
    retry: retryOutage,
  });

  const choices = query.data?.choices ?? [];

  function find(value: string) {
    setAdding(false);
    setTerm(value);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    find(draft.trim());
  }

  function detected(code: string) {
    setScanning(false);
    setDraft(code);
    find(code);
  }

  const notFound = query.error instanceof ApiError && query.error.status === 404;

  const message = badBarcode ? "That barcode's numbers don't add up. Check it and try again."
    : query.isFetching ? "Searching foods…"
    : notFound ? "No product with this barcode yet. Add it from the label, and others who scan it will find it."
    : query.isError ? query.error.message
    : !term ? "Search for a food, or scan a packaged food's barcode."
    : choices.length === 0 ? "No foods found. Try another name."
    : null;

  return (
    <>
      <form onSubmit={search}>
        <Label {...stylex.props(styles.formLabel)} htmlFor="search-query">Find a food</Label>
        <div {...stylex.props(styles.searchFormRow)}>
          <Input
            id="search-query"
            {...stylex.props(styles.searchFormInput)}
            type="search"
            minLength={2}
            maxLength={80}
            placeholder="Try maçã, frango, oats, or a barcode..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            required
          />
          <Button type="submit" {...stylex.props(styles.searchFormButton)}>
            <Search size={16} /> Search
          </Button>
          <Button type="button" variant="outline" {...stylex.props(styles.searchFormButton)} aria-pressed={scanning} onClick={() => setScanning(!scanning)}>
            <ScanBarcode size={16} /> Scan
          </Button>
        </div>
      </form>
      {scanning && <BarcodeScanner onDetected={detected} onCancel={() => setScanning(false)} />}
      <p {...stylex.props(styles.fieldHint)}>
        Search in Portuguese, English, or French, or by barcode.
      </p>
      {message ? (
        <p {...stylex.props(styles.searchMessage)}>{message}</p>
      ) : (
        <ul {...stylex.props(styles.resultsList)} aria-label="Food search results">
          {choices.map((choice, index) => (
            <li key={choice.key} {...stylex.props(index > 0 && styles.resultsItemBorder)}>
              <SelectableResult
                id={`search-${choice.key}`}
                name={choice.source.basis.name}
                meta={<ChoiceMeta choice={choice} />}
                checked={selection.has(choice.key)}
                onToggle={() => tick(selection, choice.key, portionFood(choice.source, choice.serving?.amount ?? 100))}
              />
            </li>
          ))}
        </ul>
      )}
      {notFound && (adding ? (
        <ManualFoodForm key={term} actionLabel="Add to selection" barcode={term} onPick={(food) => {
          tick(selection, `barcode:${term}`, { submitted: food, preview: recordedFood(food) });
          setAdding(false);
        }} />
      ) : (
        <Button type="button" variant="outline" {...stylex.props(styles.widthFull)} onClick={() => setAdding(true)}>
          Add this product
        </Button>
      ))}
      {/* Open Food Facts' licence asks for its credit next to the results. */}
      {query.data?.attribution.filter((source) => source.provider !== "ciqual").map((source) => (
        <a
          {...stylex.props(styles.sourceLink)}
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source: {source.label}
        </a>
      ))}
    </>
  );
}

function ChoiceMeta({ choice }: { choice: Choice }) {
  return (
    <>
      {isUserAdded(choice.source.basis) && <span {...stylex.props(styles.userAdded)}>User-added · </span>}
      {choice.brand && `${choice.brand} · `}per 100 {unitLabels[choice.source.basis.quantity.unit]} · {nutrientLine(choice.source.basis.nutrients)}
    </>
  );
}
