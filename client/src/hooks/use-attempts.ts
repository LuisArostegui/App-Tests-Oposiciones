import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";

const attemptUpdateQueues = new Map<number, Promise<unknown>>();

export async function enqueueAttemptUpdate<T>(id: number, update: () => Promise<T>): Promise<T> {
  const previous = attemptUpdateQueues.get(id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(update);
  attemptUpdateQueues.set(id, current);
  try {
    return await current;
  } finally {
    if (attemptUpdateQueues.get(id) === current) attemptUpdateQueues.delete(id);
  }
}

export function useAttempts() {
  return useQuery({
    queryKey: [api.attempts.list.path],
    queryFn: async ({ signal }) => {
      const res = await apiFetch(api.attempts.list.path, { signal });
      if (!res.ok) throw new Error("Failed to fetch attempts");
      return api.attempts.list.responses[200].parse(await res.json());
    },
  });
}

export function useAttempt(id: number | null) {
  return useQuery({
    queryKey: [api.attempts.get.path, id],
    queryFn: async ({ signal }) => {
      if (!id) return null;
      const url = buildUrl(api.attempts.get.path, { id });
      const res = await apiFetch(url, { signal });
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
      const res = await apiFetch(api.attempts.create.path, {
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
      return enqueueAttemptUpdate(id, async () => {
        const res = await apiFetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Failed to update attempt");
        return api.attempts.update.responses[200].parse(await res.json());
      });
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
      const res = await apiFetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete attempt");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
      toast({ title: "Intento Eliminado" });
    },
    onError: () => toast({ title: "Error al Eliminar", variant: "destructive" }),
  });
}
