import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { InsertResult } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import { usePrivateMutation } from "@/hooks/use-private-mutation";

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

export function useCreateResult() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return usePrivateMutation({
    mutationFn: async (data: InsertResult) => {
      const res = await apiFetch(api.results.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save result");
      return api.results.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.results.list.path] });
      toast({ title: "Resultado Guardado", description: "Tu puntuación ha sido registrada." });
    },
    onError: () => toast({ title: "Error", description: "No se pudo guardar el resultado.", variant: "destructive" }),
  });
}
