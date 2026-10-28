import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, capturePrivateSessionEpoch, isPrivateSessionEpochCurrent } from "@/lib/queryClient";
import { usePrivateMutation } from "@/hooks/use-private-mutation";
import type { FinalizeAttemptInput } from "@shared/schema";

const attemptUpdateQueues = new Map<number, Promise<unknown>>();
const pendingAttemptUpdates = new Map<number, Map<string, Promise<unknown>>>();

export async function enqueueAttemptUpdate<T>(id: number, update: () => Promise<T>, dedupeKey?: string): Promise<T> {
  const pending = dedupeKey ? pendingAttemptUpdates.get(id)?.get(dedupeKey) : undefined;
  if (pending) return pending as Promise<T>;

  const sessionEpoch = capturePrivateSessionEpoch();
  const previous = attemptUpdateQueues.get(id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => {
    if (!isPrivateSessionEpochCurrent(sessionEpoch)) throw new Error("La sesión cambió antes de guardar este intento.");
    return update();
  });
  attemptUpdateQueues.set(id, current);
  if (dedupeKey) {
    const requests = pendingAttemptUpdates.get(id) ?? new Map<string, Promise<unknown>>();
    requests.set(dedupeKey, current);
    pendingAttemptUpdates.set(id, requests);
  }
  try {
    return await current;
  } finally {
    if (attemptUpdateQueues.get(id) === current) attemptUpdateQueues.delete(id);
    if (dedupeKey) {
      const requests = pendingAttemptUpdates.get(id);
      if (requests?.get(dedupeKey) === current) requests.delete(dedupeKey);
      if (requests?.size === 0) pendingAttemptUpdates.delete(id);
    }
  }
}

function serializeAttemptSnapshot(value: object): string {
  const snapshot = value as { currentIndex?: number; answers?: Record<string, string> };
  const answers = snapshot.answers
    ? Object.fromEntries(Object.entries(snapshot.answers).sort(([first], [second]) => first.localeCompare(second)))
    : undefined;
  return JSON.stringify({ currentIndex: snapshot.currentIndex, answers });
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

  return usePrivateMutation({
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

  return usePrivateMutation({
    mutationFn: async ({ id, ...updates }: { id: number; currentIndex?: number; answers?: Record<string, string> }) => {
      const url = buildUrl(api.attempts.update.path, { id });
      return enqueueAttemptUpdate(id, async () => {
        const res = await apiFetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Failed to update attempt");
        return api.attempts.update.responses[200].parse(await res.json());
      }, `update:${serializeAttemptSnapshot(updates)}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.attempts.get.path, variables.id] });
    },
  });
}

export function useFinalizeAttempt() {
  const queryClient = useQueryClient();

  return usePrivateMutation({
    mutationFn: async ({ id, ...input }: { id: number } & FinalizeAttemptInput) => {
      const url = buildUrl(api.attempts.finalize.path, { id });
      return enqueueAttemptUpdate(id, async () => {
        const res = await apiFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error("Failed to finalize attempt");
        return api.attempts.finalize.responses[200].parse(await res.json());
      }, `finalize:${serializeAttemptSnapshot(input)}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.attempts.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.attempts.get.path, variables.id] });
      queryClient.invalidateQueries({ queryKey: [api.results.list.path] });
    },
  });
}

export function useDeleteAttempt() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return usePrivateMutation({
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
