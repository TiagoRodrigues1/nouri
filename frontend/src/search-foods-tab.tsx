import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ScanBarcode, Search } from "lucide-react";
import { styles } from "./form-styles";
import { BarcodeScanner } from "./barcode-scanner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ApiError, lookupBarcode, searchFoods, type Candidate, type PackagedProduct } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { typedAmount } from "./lib/typed-amount";
import { isBarcode, scaleFood, type FoodSubmission, type RecordedFood } from "../../src/food/contract";

type FoodInput = FoodSubmission["food"];

// A food the tab offers. `per100` is 100 g or ml of it, which previews any amount. Ciqual foods log by reference,
// so the server measures them; a scanned product logs as the scaled label, carrying its Open Food Facts reference.
type Choice = {
  key: string;
  per100: RecordedFood;
  brand: string | null;
  serving: PackagedProduct["serving"];
  toFood: (amount: number) => FoodInput;
};

function catalogChoice(candidate: Candidate): Choice {
  return {
    key: `ciqual:${candidate.ref.id}`,
    per100: { name: candidate.name, quantity: { amount: 100, unit: "g" }, nutrients: candidate.nutrients, catalogRef: candidate.ref },
    brand: null,
    serving: null,
    toFood: (amount) => ({ kind: "catalog", ref: candidate.ref, quantity: { amount, unit: "g" } }),
  };
}

function packagedChoice(product: PackagedProduct): Choice {
  return {
    key: `barcode:${product.barcode}`,
    per100: product.food,
    brand: product.brand,
    serving: product.serving,
    toFood: (amount) => {
      const { catalogRef, ...food } = scaleFood(product.food, amount);

      return catalogRef ? { ...food, catalogRef } : food;
    },
  };
}

// Only an outage is worth asking Open Food Facts again; a missing product stays missing.
const retryOutage = (failures: number, error: Error) => failures < 1 && error instanceof ApiError && error.status === 502;

export function SearchFoodsTab({ pending, onSave }: { pending: boolean; onSave: (event: FormEvent<HTMLFormElement>, food: FoodInput) => void }) {
  const [draft, setDraft] = useState("");
  const [term, setTerm] = useState("");
  const [scanning, setScanning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Digits are a barcode, never a name, so a mistyped code says so instead of finding no foods.
  const digits = /^\d+$/.test(term);
  const barcode = digits && isBarcode(term) ? term : null;

  const searchQuery = useQuery({
    queryKey: ["foods", term],
    queryFn: () => searchFoods(term),
    enabled: !digits && term.length >= 2,
  });

  const productQuery = useQuery({
    queryKey: ["barcodes", barcode],
    queryFn: () => lookupBarcode(barcode ?? ""),
    enabled: barcode !== null,
    retry: retryOutage,
  });

  const active = digits ? productQuery : searchQuery;

  const choices = digits
    ? (productQuery.data ? [packagedChoice(productQuery.data.product)] : [])
    : (searchQuery.data?.items.map(catalogChoice) ?? []);

  const selected = choices.find((choice) => choice.key === selectedKey) ?? null;

  function find(value: string) {
    setSelectedKey(null);
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

  const notFound = active.error instanceof ApiError && active.error.status === 404;

  const message = digits && !barcode ? "That barcode's numbers don't add up. Check it and try again."
    : active.isFetching ? (digits ? "Looking up the barcode…" : "Searching foods…")
    : notFound ? "No product with this barcode yet. Add it manually from the label."
    : active.isError ? active.error.message
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
            type="search"
            minLength={2}
            maxLength={80}
            placeholder="Try apple, oats, or a barcode..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            required
          />
          <Button type="submit">
            <Search size={16} /> Search
          </Button>
          <Button type="button" variant="outline" aria-pressed={scanning} onClick={() => setScanning(!scanning)}>
            <ScanBarcode size={16} /> Scan
          </Button>
        </div>
      </form>
      {scanning && <BarcodeScanner onDetected={detected} onCancel={() => setScanning(false)} />}
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
                  <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{choice.per100.name}</strong>
                  <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                    {choice.brand && `${choice.brand} · `}per 100 {unitLabels[choice.per100.quantity.unit]} · {nutrientLine(choice.per100.nutrients)}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Keyed by choice, so choosing another food restarts from its default amount. */}
      {selected && <ChoiceForm key={selected.key} choice={selected} pending={pending} onSave={onSave} />}
      {active.data?.attribution.map((source) => (
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

function ChoiceForm({ choice, pending, onSave }: { choice: Choice; pending: boolean; onSave: (event: FormEvent<HTMLFormElement>, food: FoodInput) => void }) {
  const unit = unitLabels[choice.per100.quantity.unit];
  const [amount, setAmount] = useState(String(choice.serving?.amount ?? 100));
  const typed = typedAmount(amount);
  const preview = typed === null ? choice.per100 : scaleFood(choice.per100, typed);

  return (
    <form {...stylex.props(styles.selectedForm)} onSubmit={(event) => (typed === null ? event.preventDefault() : onSave(event, choice.toFood(typed)))}>
      <strong {...stylex.props(styles.selectedName)}>{choice.per100.name}</strong>
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
        Add to log
      </Button>
    </form>
  );
}
