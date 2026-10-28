import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileJson } from "lucide-react";
import { useImportTest } from "@/hooks/use-tests";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, QUESTION_IMPORT_MAX_BYTES, questionImportContentSchema, questionImportFilenameSchema } from "@shared/routes";

function formatImportIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  const fieldNames: Record<string, string> = {
    filename: "nombre",
    pregunta: "pregunta",
    respuestas: "respuestas",
    respuesta_correcta: "respuesta_correcta",
    oposicion: "oposicion",
  };
  const messages = issues.slice(0, 10).map((issue) => {
    const question = issue.path.find((part): part is number => typeof part === "number");
    const fieldPath = issue.path.filter((part): part is string => typeof part === "string")
      .reverse().find((part) => part in fieldNames);
    const location = [
      question === undefined ? undefined : `Pregunta ${question + 1}`,
      fieldPath ? `campo ${fieldNames[fieldPath]}` : undefined,
    ].filter(Boolean).join(", ");
    return `${location ? `${location}: ` : ""}${issue.message.slice(0, 300)}`;
  });
  if (issues.length > messages.length) messages.push(`Y ${issues.length - messages.length} error(es) más.`);
  return messages.join(" ");
}

interface ImportDialogProps {
  trigger?: React.ReactNode;
}

export function ImportDialog({ trigger }: ImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const { mutate, isPending } = useImportTest();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] ?? null;
    e.currentTarget.value = "";
    setErrorMessage(null);
    setFile(selectedFile);
  };

  const handleImport = () => {
    if (!file) return;
    if (file.size > QUESTION_IMPORT_MAX_BYTES) {
      setErrorMessage("El archivo supera el límite de 5 MiB. Selecciona uno más pequeño.");
      return;
    }
    const filenameResult = questionImportFilenameSchema.safeParse(file.name);
    if (!filenameResult.success) {
      setErrorMessage(`Nombre de archivo inválido: ${filenameResult.error.issues[0]?.message ?? "revisa el nombre"}.`);
      return;
    }

    const reader = new FileReader();
    setIsReading(true);
    reader.onerror = () => {
      setIsReading(false);
      setErrorMessage("No se pudo leer el archivo. Selecciónalo de nuevo.");
    };
    reader.onload = () => {
      setIsReading(false);
      try {
        if (typeof reader.result !== "string") throw new Error("El archivo no contiene texto JSON legible.");
        const content: unknown = JSON.parse(reader.result);
        const contentResult = questionImportContentSchema.safeParse(content);
        if (!contentResult.success) {
          setErrorMessage(formatImportIssues(contentResult.error.issues));
          return;
        }
        const requestResult = api.tests.import.input.safeParse({ filename: filenameResult.data, content: contentResult.data });
        if (!requestResult.success) {
          setErrorMessage(formatImportIssues(requestResult.error.issues));
          return;
        }
        setErrorMessage(null);
        mutate(requestResult.data, {
          onSuccess: () => {
            setOpen(false);
            setFile(null);
            setErrorMessage(null);
            setIsReading(false);
          },
          onError: (error) => {
            setIsReading(false);
            setErrorMessage(error.message || "No se pudo importar el archivo.");
          }
        });
      } catch (err) {
        setErrorMessage(err instanceof SyntaxError ? "JSON mal formado. Revisa el archivo y vuelve a seleccionarlo." : "No se pudo procesar el archivo.");
      }
    };
    reader.readAsText(file);
  };

  const defaultTrigger = (
    <Button className="gap-2 bg-gradient-to-r from-primary to-primary/90 shadow-lg shadow-primary/20 shrink-0">
      <UploadCloud className="w-4 h-4" />
      <span className="hidden sm:inline">Importar JSON Local</span>
      <span className="sm:hidden">Importar</span>
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && (isReading || isPending)) return;
      setOpen(nextOpen);
      if (!nextOpen) {
        setFile(null);
        setErrorMessage(null);
      }
    }}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Preguntas de Test</DialogTitle>
          <DialogDescription>Selecciona un archivo JSON con entre 1 y 1000 preguntas. Tamaño máximo: 5 MiB.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="file">Selecciona archivo .json</Label>
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 transition-colors cursor-pointer relative">
              <Input 
                id="file" 
                type="file" 
                accept=".json" 
                aria-describedby="import-help import-error"
                disabled={isReading || isPending}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileChange}
              />
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <FileJson className="w-8 h-8" />
                <span>{file ? file.name : "Arrastra o haz clic para seleccionar"}</span>
              </div>
            </div>
          </div>
          <p id="import-help" className="text-sm text-muted-foreground">
            <a className="underline underline-offset-4" href="/question-import-example.json" download>Descargar ejemplo válido</a>
          </p>
          {errorMessage && <p id="import-error" className="text-sm text-destructive" role="alert">{errorMessage}</p>}
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isReading || isPending}>Cancelar</Button>
          <Button onClick={handleImport} disabled={!file || isPending || isReading}>
            {isReading ? "Leyendo archivo..." : isPending ? "Importando..." : "Importar Archivo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
