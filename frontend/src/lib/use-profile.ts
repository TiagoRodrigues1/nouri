import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileViewSchema } from "../../../src/profile/contract";
import type { Profile } from "../../../src/profile/contract";
import { request } from "./api";

// The saved profile and the targets it suggests on the day. `enabled` lets a closed dialog skip the read.
export function useProfileQuery(date: string, enabled = true) {
  return useQuery({
    queryKey: ["profile", date],
    queryFn: () => request(`/v1/profile/${date}`, profileViewSchema),
    enabled,
  });
}

// Saving returns the view for the same day, so the form fills from the response without a second read.
export function useSaveProfile(date: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (profile: Profile) => request(`/v1/profile/${date}`, profileViewSchema, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }),
    onSuccess: (view) => client.setQueryData(["profile", date], view),
  });
}
