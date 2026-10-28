import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { apiFetch } from "@/lib/queryClient";

export function useResults() {
  return useQuery({
    queryKey: [api.results.list.path],
    queryFn: async ({ signal }) => {
      const res = await apiFetch(api.results.list.path, { signal });
      if (!res.ok) throw new Error("Failed to fetch results");
      return api.results.list.responses[200].parse(await res.json());
    },
  });
}
