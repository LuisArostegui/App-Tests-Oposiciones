import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type errorSchemas } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

// Fetch list of local tests
export function useTests() {
  return useQuery({
    queryKey: [api.tests.list.path],
    queryFn: async () => {
      const res = await fetch(api.tests.list.path);
      if (!res.ok) throw new Error("Failed to fetch tests");
      return api.tests.list.responses[200].parse(await res.json());
    },
  });
}

// Fetch a specific test by ID (filename)
export function useTest(id: string) {
  return useQuery({
    queryKey: [api.tests.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.tests.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch test details");
      return api.tests.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

// Import a local JSON file
export function useImportTest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ filename, content }: { filename: string; content: any[] }) => {
      const res = await fetch(api.tests.import.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to import test");
      }
      return api.tests.import.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.tests.list.path] });
      toast({
        title: "Importación Exitosa",
        description: `Se importaron ${data.count} preguntas correctamente.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error en la Importación",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// === QUESTIONS ===

export function useCreateQuestion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (question: { testId: string; questionText: string; answers: Record<string, string>; correctAnswer: string; category?: string }) => {
      const res = await fetch(api.questions.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(question),
      });
      if (!res.ok) throw new Error("Failed to create question");
      return api.questions.create.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      // Invalidate both the specific test query and test list
      queryClient.invalidateQueries({ queryKey: [api.tests.get.path, data.testId] });
      queryClient.invalidateQueries({ queryKey: [api.tests.list.path] });
      toast({ title: "Pregunta Creada" });
    },
    onError: () => toast({ title: "Error al Crear", variant: "destructive" }),
  });
}

export function useUpdateQuestion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Record<string, any>) => {
      const url = buildUrl(api.questions.update.path, { id });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update question");
      return api.questions.update.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      // Invalidate the specific test query using testId from the response
      queryClient.invalidateQueries({ queryKey: [api.tests.get.path, data.testId] });
      toast({ title: "Pregunta Actualizada" });
    },
    onError: () => toast({ title: "Error al Actualizar", variant: "destructive" }),
  });
}

export function useDeleteQuestion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.questions.delete.path, { id });
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete question");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tests.get.path] });
      toast({ title: "Pregunta Eliminada" });
    },
    onError: () => toast({ title: "Error al Eliminar", variant: "destructive" }),
  });
}

// === TEST MANAGEMENT ===
export function useDeleteTest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (testId: string) => {
      const url = buildUrl(api.tests.delete.path, { id: testId });
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete test");
      return testId;
    },
    onSuccess: (deletedTestId) => {
      // Invalidate the test list
      queryClient.invalidateQueries({ queryKey: [api.tests.list.path] });
      // Also invalidate the specific test query if it was cached
      queryClient.invalidateQueries({ queryKey: [api.tests.get.path, deletedTestId] });
      toast({ title: "Test Eliminado" });
    },
    onError: () => toast({ title: "Error al Eliminar", variant: "destructive" }),
  });
}

export function useRenameTest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ testId, newName }: { testId: string; newName: string }) => {
      const url = buildUrl(api.tests.rename.path, { id: testId });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });
      if (!res.ok) throw new Error("Failed to rename test");
      const result = api.tests.rename.responses[200].parse(await res.json());
      return { oldTestId: testId, ...result };
    },
    onSuccess: (data) => {
      // Invalidate the test list to show the new name
      queryClient.invalidateQueries({ queryKey: [api.tests.list.path] });
      // Invalidate the old test ID query
      queryClient.invalidateQueries({ queryKey: [api.tests.get.path, data.oldTestId] });
      // Also invalidate any query for the new test ID
      queryClient.invalidateQueries({ queryKey: [api.tests.get.path, data.newId] });
      toast({ title: "Test Renombrado" });
    },
    onError: () => toast({ title: "Error al Renombrar", variant: "destructive" }),
  });
}
