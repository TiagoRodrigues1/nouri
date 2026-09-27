import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "./components/ui/button";

// What a page shows in place of a query's data: a prompt to connect, the error with a retry, or a loading line.
export function queryStatus(token: string, query: UseQueryResult<unknown>, messages: { disconnected: string; loading: string }): ReactNode {
  if (!token) return messages.disconnected;

  if (query.isError) {
    return (
      <>
        {query.error.message}{" "}
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>
      </>
    );
  }

  return query.isPending ? messages.loading : null;
}
