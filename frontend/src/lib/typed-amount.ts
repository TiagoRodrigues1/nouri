// An amount field holds text while typing, so a half-typed "0." is not rewritten under the cursor.
// It is usable once it reads as a positive number; the browser checks the rest of its range.
export function typedAmount(text: string): number | null {
  const amount = Number(text);

  return text.trim() !== "" && amount > 0 ? amount : null;
}
