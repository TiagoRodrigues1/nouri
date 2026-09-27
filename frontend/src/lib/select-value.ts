function isOneOf<const Values extends readonly string[]>(values: Values, value: string): value is Values[number] {
  return values.includes(value);
}

export function selectValue<const Values extends readonly [string, ...string[]]>(
  values: Values, value: string, fallback: Values[number],
): Values[number] {
  return isOneOf(values, value) ? value : fallback;
}
