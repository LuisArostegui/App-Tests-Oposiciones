import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useAttempts() {
  return useQuery({
    queryKey: [api.attempts.list.path],
    queryFn: async () => {
      const res = await fetch(api.attempts.list.path);
      if (!res.ok) throw new Error("Failed to fetch attempts");
      return api.attempts.list.responses[200].parse(await res.json());
    },
  });
}

export function useAttempt(id: number | null) {
  return useQuery({
    queryKey: [api.attempts.get.path, id],
    queryFn: async () => {
      if (!id) return null;
      const url = buildUrl(api.attempts.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch attempt");
      return api.attempts.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateAttempt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { testId: string; questionOrder: number[] }) => {
      const res = await fetch(api.attempts.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create attempt");
      return api.attempts.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
    },
  });
}

export function useUpdateAttempt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number; currentIndex?: number; answers?: Record<string, string>; status?: string; correctCount?: number; score?: number }) => {
      const url = buildUrl(api.attempts.update.path, { id });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update attempt");
      return api.attempts.update.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.attempts.get.path, variables.id] });
    },
  });
}

export function useDeleteAttempt() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.attempts.delete.path, { id });
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete attempt");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
      toast({ title: "Intento Eliminado" });
    },
    onError: () => toast({ title: "Error al Eliminar", variant: "destructive" }),
  });
}
