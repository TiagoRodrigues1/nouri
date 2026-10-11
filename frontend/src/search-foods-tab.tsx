import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ScanBarcode, Search } from "lucide-react";
import { styles } from "./form-styles";
import { BarcodeScanner } from "./barcode-scanner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ManualFoodForm } from "./manual-food-form";
import { ApiError, lookupBarcode, searchFoods, type Candidate, type LabelFood, type SearchResult } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { portionFood, type FoodPortion, type FoodSource } from "./lib/food-portion";
import { typedAmount } from "./lib/typed-amount";
import { isBarcode, isUserAdded, recordedFood } from "../../src/food/contract";

// A food the tab offers. Its basis is 100 g or ml, which previews any amount. Ciqual foods log by reference,
// so the server measures them; a scanned product or community food logs as the scaled label, carrying its reference.
type Choice = {
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
async function findChoices(term: string): Promise<{ choices: Choice[]; attribution: SearchResult["attribution"] }> {
  if (isBarcode(term)) {
    const { product, attribution } = await lookupBarcode(term);

    return { choices: [labelChoice(product, `barcode:${product.barcode}`)], attribution };
  }

  const { items, attribution } = await searchFoods(term);

  return { choices: items.map((item, index) => item.kind === "community" ? labelChoice(item, `label:${index}`) : ciqualChoice(item)), attribution };
}

// Only an outage is worth asking again; a missing product stays missing.
const retryOutage = (failures: number, error: Error) => failures < 1 && error instanceof ApiError && error.status === 502;

// `onPick` gets the submission and its matching preview at the chosen amount.
type PickChoice = (portion: FoodPortion) => void;

// Food search and barcode lookup. A barcode nobody knows can be added from its label. The log dialog logs the food picked; the meal editor adds it to the meal.
export function SearchFoodPicker({ actionLabel, pending = false, onPick }: { actionLabel: string; pending?: boolean; onPick: PickChoice }) {
  const [draft, setDraft] = useState("");
  const [term, setTerm] = useState("");
  const [scanning, setScanning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
  const selected = choices.find((choice) => choice.key === selectedKey) ?? null;

  function find(value: string) {
    setSelectedKey(null);
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
              <button
                {...stylex.props(styles.resultsButton, selectedKey === choice.key && styles.resultsButtonSelected)}
                type="button"
                aria-pressed={selectedKey === choice.key}
                onClick={() => setSelectedKey(choice.key)}
              >
                <span>
                  <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{choice.source.basis.name}</strong>
                  <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                    {isUserAdded(choice.source.basis) && <span {...stylex.props(styles.userAdded)}>User-added · </span>}
                    {choice.brand && `${choice.brand} · `}per 100 {unitLabels[choice.source.basis.quantity.unit]} · {nutrientLine(choice.source.basis.nutrients)}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {notFound && (adding ? (
        <ManualFoodForm key={term} actionLabel={actionLabel} pending={pending} barcode={term} onPick={(food) => onPick({ submitted: food, preview: recordedFood(food) })} />
      ) : (
        <Button type="button" variant="outline" {...stylex.props(styles.widthFull)} onClick={() => setAdding(true)}>
          Add this product
        </Button>
      ))}
      {/* Keyed by choice, so choosing another food restarts from its default amount. */}
      {selected && <ChoiceForm key={selected.key} choice={selected} pending={pending} actionLabel={actionLabel} onPick={onPick} />}
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

function ChoiceForm({ choice, pending, actionLabel, onPick }: { choice: Choice; pending: boolean; actionLabel: string; onPick: PickChoice }) {
  const unit = unitLabels[choice.source.basis.quantity.unit];
  const [amount, setAmount] = useState(String(choice.serving?.amount ?? 100));
  const typed = typedAmount(amount);
  const preview = typed === null ? choice.source.basis : portionFood(choice.source, typed).preview;

  return (
    <form {...stylex.props(styles.selectedForm)} onSubmit={(event) => {
      event.preventDefault();

      if (typed !== null) onPick(portionFood(choice.source, typed));
    }}>
      <strong {...stylex.props(styles.selectedName)}>{choice.source.basis.name}</strong>
      <Label {...stylex.props(styles.formLabel, styles.selectedLabel)} htmlFor="search-amount">Amount in {unit}</Label>
      <Input
        id="search-amount"
        type="number"
        min="0.001"
        max="10000"
        step="0.001"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        required
      />
      {choice.serving && <small {...stylex.props(styles.resultsMeta)}>One serving is {choice.serving.amount} {unit}.</small>}
      <small {...stylex.props(styles.resultsMeta)}>{nutrientLine(preview.nutrients)}</small>
      <Button type="submit" disabled={pending} {...stylex.props(styles.selectedButton)}>
        {actionLabel}
      </Button>
    </form>
  );
}
