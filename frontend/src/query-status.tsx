import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "./components/ui/button";

// What a page shows in place of a query's data: the error with a retry, or a loading line.
// `failed` names what could not load when the page around it has loaded, like "Targets could not load: ".
export function queryStatus(query: UseQueryResult<unknown>, loading: string, failed = ""): ReactNode {
  if (query.isError) {
    return (
      <span role="alert">
        {failed}{query.error.message}{" "}
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>
      </span>
    );
  }

  return query.isPending ? loading : null;
}
