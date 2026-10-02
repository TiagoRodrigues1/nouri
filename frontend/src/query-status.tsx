import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "./components/ui/button";

// What a page shows in place of a query's data: the error with a retry, or a loading line.
export function queryStatus(query: UseQueryResult<unknown>, loading: string): ReactNode {
  if (query.isError) {
    return (
      <>
        {query.error.message}{" "}
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>
      </>
    );
  }

  return query.isPending ? loading : null;
}
