import * as stylex from "@stylexjs/stylex";
import { styles } from "./form-styles";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { dateLabel, format, searchFoods, type Candidate } from "./lib/api";
import type { FoodSubmission } from "../../src/food/contract";

type FoodInput = FoodSubmission["food"];

type LogFoodDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  date: string;
  isToday: boolean;
  pending: boolean;
  onSave: (event: FormEvent<HTMLFormElement>, food: FoodInput) => void;
  onConnect: () => void;
};

export function LogFoodDialog({ open, onOpenChange, token, date, isToday, pending, onSave, onConnect }: LogFoodDialogProps) {
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [grams, setGrams] = useState("100");

  const searchQuery = useQuery({
    queryKey: ["foods", token, searchTerm],
    queryFn: () => searchFoods(token, searchTerm),
    enabled: Boolean(token) && searchTerm.length >= 2,
  });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelected(null);
    setSearchTerm(searchDraft.trim());
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle {...stylex.props(styles.dialogTitle)}>Log a food</DialogTitle>
          <DialogDescription {...stylex.props(styles.dialogDescription)}>
            Choose a food from the catalog or enter one manually. It will be
            added to {isToday ? "today" : dateLabel(date)}.
          </DialogDescription>
          <Tabs defaultValue="search">
            <TabsList sx={styles.widthFull}>
              <TabsTrigger value="search" sx={styles.flexOne}>
                Search foods
              </TabsTrigger>
              <TabsTrigger value="manual" sx={styles.flexOne}>
                Add manually
              </TabsTrigger>
            </TabsList>
            <TabsContent value="search">
              <form onSubmit={search}>
                <label {...stylex.props(styles.formLabel)} htmlFor="search-query">Find a food</label>
                <div {...stylex.props(styles.searchFormRow)}>
                  <Input
                    id="search-query"
                    type="search"
                    minLength={2}
                    maxLength={80}
                    placeholder="Try apple, oats, chicken..."
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    required
                  />
                  <Button type="submit" disabled={!token}>
                    <Search size={16} /> Search
                  </Button>
                </div>
              </form>
              <p {...stylex.props(styles.fieldHint)}>
                Ciqual results show nutrition per 100 g.
              </p>
              {!token ? (
                <div {...stylex.props(styles.searchMessage)}>
                  <p>Connect your food log to search.</p>
                  <Button type="button" variant="outline" onClick={onConnect}>
                    Connect your log
                  </Button>
                </div>
              ) : searchQuery.isFetching ? (
                <p {...stylex.props(styles.searchMessage)}>Searching foods…</p>
              ) : searchQuery.isError ? (
                <p {...stylex.props(styles.searchMessage)}>{searchQuery.error.message}</p>
              ) : searchTerm && !searchQuery.data?.items.length ? (
                <p {...stylex.props(styles.searchMessage)}>
                  No foods found. Try another name.
                </p>
              ) : !searchTerm ? (
                <p {...stylex.props(styles.searchMessage)}>
                  Search for a food to get started.
                </p>
              ) : (
                <ul {...stylex.props(styles.resultsList)} aria-label="Food search results">
                  {searchQuery.data?.items.map((item, index) => (
                    <li key={item.ref.id} {...stylex.props(index > 0 && styles.resultsItemBorder)}>
                      <button
                        {...stylex.props(styles.resultsButton, selected?.ref.id === item.ref.id && styles.resultsButtonSelected)}
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          setGrams("100");
                        }}
                      >
                        <span>
                          <strong {...stylex.props(styles.resultsText, styles.resultsName)}>{item.name}</strong>
                          <small {...stylex.props(styles.resultsText, styles.resultsMeta)}>
                            {format(item.nutrients.kcal)} kcal · P{" "}
                            {format(item.nutrients.proteinG, 1)}g · C{" "}
                            {format(item.nutrients.carbsG, 1)}g · F{" "}
                            {format(item.nutrients.fatG, 1)}g
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selected && (
                <form
                  {...stylex.props(styles.selectedForm)}
                  onSubmit={(event) =>
                    onSave(event, {
                      kind: "catalog",
                      ref: selected.ref,
                      quantity: { amount: Number(grams), unit: "g" },
                    })
                  }
                >
                  <strong {...stylex.props(styles.selectedName)}>{selected.name}</strong>
                  <label {...stylex.props(styles.formLabel, styles.selectedLabel)} htmlFor="catalog-grams">Amount in grams</label>
                  <Input
                    id="catalog-grams"
                    type="number"
                    min="0.001"
                    max="10000"
                    step="0.001"
                    value={grams}
                    onChange={(event) => setGrams(event.target.value)}
                    required
                  />
                  <Button type="submit" disabled={pending} sx={styles.selectedButton}>
                    Add to log
                  </Button>
                </form>
              )}
              {searchQuery.data?.attribution.map((source) => (
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
            </TabsContent>
            <TabsContent value="manual">
              <ManualForm
                disabled={!token || pending}
                onSubmit={onSave}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
  );
}

function ManualForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>, food: FoodInput) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    onSubmit(event, {
      name:
        event.currentTarget
          .querySelector<HTMLInputElement>("#food-name")
          ?.value.trim() ?? "",
      quantity: { amount: Number(data.get("grams")), unit: "g" },
      nutrients: {
        kcal: Number(data.get("kcal")),
        proteinG: Number(data.get("protein")),
        carbsG: Number(data.get("carbs")),
        fatG: Number(data.get("fat")),
      },
    });
  }

  return (
    <form {...stylex.props(styles.formStack)} onSubmit={submit}>
      <div>
        <label {...stylex.props(styles.formLabel)} htmlFor="food-name">Food name</label>
        <Input
          id="food-name"
          name="name"
          maxLength={200}
          placeholder="e.g. Homemade granola"
          required
        />
      </div>
      <div>
        <label {...stylex.props(styles.formLabel)} htmlFor="manual-grams">Amount in grams</label>
        <Input
          id="manual-grams"
          name="grams"
          type="number"
          min="0.001"
          max="1000000"
          step="0.001"
          required
        />
      </div>
      <p {...stylex.props(styles.formSubhead)}>NUTRITION FOR THIS AMOUNT</p>
      <div {...stylex.props(styles.manualGrid)}>
        {[
          ["kcal", "Calories (kcal)"],
          ["protein", "Protein (g)"],
          ["carbs", "Carbs (g)"],
          ["fat", "Fat (g)"],
        ].map(([name, label]) => (
          <div key={name}>
            <label {...stylex.props(styles.formLabel)} htmlFor={`manual-${name}`}>{label}</label>
            <Input
              id={`manual-${name}`}
              name={name}
              type="number"
              min="0"
              max="1000000"
              step="0.001"
              required
            />
          </div>
        ))}
      </div>
      <Button sx={[styles.widthFull, styles.manualSubmit]} type="submit" disabled={disabled}>
        Add to log
      </Button>
      {!disabled ? null : (
        <p {...stylex.props(styles.fieldHint)}>Connect your food log to save entries.</p>
      )}
    </form>
  );
}
