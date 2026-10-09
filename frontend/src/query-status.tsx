import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "./components/ui/button";

// The query's error with a retry, or null. A page that shows a skeleton while loading needs only this.
// `failed` names what could not load when the page around it has loaded, like "Targets could not load: ".
export function queryError(query: UseQueryResult<unknown>, failed = ""): ReactNode {
  if (!query.isError) return null;

  return (
    <span role="alert">
      {failed}{query.error.message}{" "}
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>
    </span>
  );
}

// What a page shows in place of a query's data: the error with a retry, or a loading line.
export function queryStatus(query: UseQueryResult<unknown>, loading: string, failed = ""): ReactNode {
  return queryError(query, failed) ?? (query.isPending ? loading : null);
}

// What a page shows instead of a query's data: its skeleton while loading, then the error with a retry, set in
// the page's message style. Pages that show a skeleton call this once the data is missing or failed.
export function queryFallback(query: UseQueryResult<unknown>, skeleton: ReactNode, style: StyleXStyles): ReactNode {
  return query.isPending ? skeleton : <p {...stylex.props(style)}>{queryError(query)}</p>;
}
