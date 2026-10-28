import { useCallback, useEffect, useState, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useTest } from "@/hooks/use-tests";
import { useResults } from "@/hooks/use-results";
import { useAttempt, useCreateAttempt, useFinalizeAttempt, useUpdateAttempt } from "@/hooks/use-attempts";
import { QuestionCard } from "@/components/QuestionCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Flag, Shuffle, Home, Save } from "lucide-react";
import { type Question, type Result } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

function shuffleArray<T>(array: T[]): T[] {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

export default function TestView() {
  const [, params] = useRoute("/test/:id");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const attemptIdParam = searchParams.get("attempt");
  
  const testId = decodeURIComponent(params?.id || "");
  const { toast } = useToast();
  
  const { data: questions, isLoading } = useTest(testId);
  const { mutateAsync: createAttempt } = useCreateAttempt();
  const { mutateAsync: updateAttemptAsync } = useUpdateAttempt();
  const { mutateAsync: finalizeAttempt, isPending: isFinalizing } = useFinalizeAttempt();
  const { data: existingAttempt, isLoading: attemptLoading, isError: attemptError, refetch: refetchAttempt } = useAttempt(attemptIdParam ? Number(attemptIdParam) : null);
  const { data: results, isLoading: resultsLoading, isError: resultsError, refetch: refetchResults } = useResults();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [randomize, setRandomize] = useState(false);
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [attemptLoadFailed, setAttemptLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [finalizeError, setFinalizeError] = useState(false);
  const [completedResult, setCompletedResult] = useState<Result | null>(null);
  const [completedResultLookupError, setCompletedResultLookupError] = useState(false);
  const [completedResultMissing, setCompletedResultMissing] = useState(false);
  const [isRefreshingCompletedResult, setIsRefreshingCompletedResult] = useState(false);
  const resumeHandled = useRef(false);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const editRevision = useRef(0);
  const persistedRevision = useRef(0);
  const autosaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveExitInFlight = useRef(false);
  const finalizeInFlight = useRef(false);
  const historyGuardAdded = useRef(false);
  const removingHistoryGuard = useRef(false);
  const resultLookupRefreshAttempt = useRef<number | null>(null);

  const refreshCompletedResult = useCallback(async (id: number) => {
    resultLookupRefreshAttempt.current = id;
    setIsRefreshingCompletedResult(true);
    try {
      const refreshed = await refetchResults();
      if (refreshed.isError || !refreshed.data) {
        setCompletedResultLookupError(true);
        return;
      }

      const result = refreshed.data.find((entry) => entry.attemptId === id);
      setCompletedResult(result ?? null);
      setCompletedResultMissing(!result);
      setCompletedResultLookupError(false);
      resumeHandled.current = true;
    } catch {
      setCompletedResultLookupError(true);
    } finally {
      setIsRefreshingCompletedResult(false);
    }
  }, [refetchResults]);

  // Handle failed attempt load - clear URL param and show error
  useEffect(() => {
    if (attemptIdParam && !attemptLoading && !existingAttempt && !resumeHandled.current) {
      if (attemptError || (!attemptLoading && !existingAttempt)) {
        setAttemptLoadFailed(true);
        toast({ 
          title: "Intento No Encontrado", 
          description: "No se pudo encontrar el intento guardado. Empezando de nuevo.", 
          variant: "destructive" 
        });
        // Clear URL parameter
        setLocation(`/test/${encodeURIComponent(testId)}`, { replace: true });
      }
    }
  }, [attemptIdParam, attemptLoading, existingAttempt, attemptError, toast, setLocation, testId]);

  // Resume from existing attempt
  useEffect(() => {
    if (!existingAttempt || resumeHandled.current) return;

    if (existingAttempt.status === "completed") {
      if (resultsLoading) return;
      setAttemptId(existingAttempt.id);
      setAnswers(existingAttempt.answers as Record<number, string> || {});
      setIsStarted(true);
      setIsFinished(true);
      if (resultsError || !results) {
        setCompletedResultLookupError(true);
        return;
      }

      const result = results.find((entry) => entry.attemptId === existingAttempt.id);
      if (!result) {
        if (resultLookupRefreshAttempt.current !== existingAttempt.id) void refreshCompletedResult(existingAttempt.id);
        return;
      }

      resumeHandled.current = true;
      setCompletedResultLookupError(false);
      setCompletedResult(result ?? null);
      setCompletedResultMissing(false);
      return;
    }

    if (questions && !resumeHandled.current) {
      resumeHandled.current = true;
      const order = existingAttempt.questionOrder as number[];
      const orderedQuestions = order
        .map(qId => questions.find(q => q.id === qId))
        .filter((q): q is Question => q !== undefined);
      
      if (orderedQuestions.length === 0) {
        toast({ 
          title: "Preguntas No Encontradas", 
          description: "Las preguntas de este test han sido eliminadas. Empezando de nuevo.", 
          variant: "destructive" 
        });
        setLocation(`/test/${encodeURIComponent(testId)}`, { replace: true });
        return;
      }
      
      // Clamp currentIndex to valid range
      const clampedIndex = Math.min(existingAttempt.currentIndex, orderedQuestions.length - 1);
      
      setActiveQuestions(orderedQuestions);
      setCurrentIndex(clampedIndex);
      setAnswers(existingAttempt.answers as Record<number, string> || {});
      setAttemptId(existingAttempt.id);
      setIsStarted(true);
    }
  }, [existingAttempt, questions, results, resultsLoading, resultsError, refreshCompletedResult, toast, setLocation, testId]);

  // Initialize questions when not resuming
  useEffect(() => {
    if (questions && !attemptIdParam && !attemptLoadFailed) {
      setActiveQuestions(randomize ? shuffleArray(questions) : questions);
    } else if (questions && attemptLoadFailed) {
      // Initialize after failed resume attempt
      setActiveQuestions(randomize ? shuffleArray(questions) : questions);
    }
  }, [questions, randomize, attemptIdParam, attemptLoadFailed]);

  // Auto-save progress every time answers or index change
  useEffect(() => {
    if (attemptId && isStarted && !isFinished && editRevision.current > persistedRevision.current) {
      const revision = editRevision.current;
      const snapshot = { answers: { ...answers }, currentIndex };
      autosaveTimeout.current = setTimeout(() => {
        setSaveState("saving");
        updateAttemptAsync({
          id: attemptId,
          ...snapshot,
        }).then(() => {
          persistedRevision.current = Math.max(persistedRevision.current, revision);
          if (revision === editRevision.current && !saveExitInFlight.current && !finalizeInFlight.current) setSaveState("saved");
        }).catch(() => {
          if (revision === editRevision.current && !saveExitInFlight.current && !finalizeInFlight.current) setSaveState("error");
        });
      }, 500);
      return () => {
        if (autosaveTimeout.current) clearTimeout(autosaveTimeout.current);
      };
    }
  }, [currentIndex, answers, attemptId, isStarted, isFinished, updateAttemptAsync]);

  useEffect(() => {
    if (!isStarted || isFinished) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (saveStateRef.current === "saved") return;
      event.preventDefault();
      event.returnValue = "";
    };
    let activeLocation = window.location.href;
    const confirmPendingNavigation = (event: PopStateEvent) => {
      if (removingHistoryGuard.current) {
        removingHistoryGuard.current = false;
        historyGuardAdded.current = false;
        activeLocation = window.location.href;
        return;
      }
      if (!historyGuardAdded.current) return;
      event.stopImmediatePropagation();
      if (saveStateRef.current !== "saved") {
        const shouldLeave = window.confirm("Hay respuestas pendientes de confirmar en el servidor. ¿Quieres abandonar este intento?");
        if (!shouldLeave) {
          window.history.pushState(window.history.state, "", activeLocation);
          return;
        }
      }
      historyGuardAdded.current = false;
      window.history.back();
    };
    if (saveStateRef.current !== "saved" && !historyGuardAdded.current) {
      window.history.pushState({ ...window.history.state, attemptSaveGuard: true }, "", activeLocation);
      historyGuardAdded.current = true;
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    window.addEventListener("popstate", confirmPendingNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      window.removeEventListener("popstate", confirmPendingNavigation, true);
    };
  }, [isStarted, isFinished, saveState]);

  const removeHistoryGuard = () => new Promise<void>((resolve) => {
    if (!historyGuardAdded.current) {
      resolve();
      return;
    }
    removingHistoryGuard.current = true;
    window.addEventListener("popstate", () => resolve(), { once: true, capture: true });
    window.history.back();
  });

  const navigateAfterSave = async (path: string) => {
    await removeHistoryGuard();
    setLocation(path);
  };

  const isLoadingState = isLoading || (attemptIdParam && attemptLoading && !attemptLoadFailed)
    || (existingAttempt?.status === "completed" && resultsLoading) || isRefreshingCompletedResult;
  
  if (isLoadingState) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground animate-pulse">Cargando test...</p>
      </div>
    </div>
  );

  if ((!questions || questions.length === 0) && existingAttempt?.status !== "completed") return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <h2 className="text-2xl font-bold mb-4">Test No Encontrado</h2>
      <Button onClick={() => setLocation("/")}>Volver al Inicio</Button>
    </div>
  );

  // Safety check - if activeQuestions is empty but we have questions, initialize
  if (!isFinished && questions && activeQuestions.length === 0 && questions.length > 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground animate-pulse">Preparando preguntas...</p>
        </div>
      </div>
    );
  }

  const currentQuestion = activeQuestions[currentIndex];
  const progress = activeQuestions.length > 0 ? ((currentIndex + 1) / activeQuestions.length) * 100 : 0;
  const answeredCount = Object.keys(answers).length;
  
  const handleAnswer = (key: string) => {
    if (currentQuestion && !isFinalizing && !saveExitInFlight.current && answers[currentQuestion.id] !== key) {
      editRevision.current += 1;
      setSaveState("pending");
      setAnswers(prev => ({ ...prev, [currentQuestion.id]: key }));
    }
  };

  const changeIndex = (getNextIndex: (index: number) => number) => {
    if (isFinalizing || saveExitInFlight.current) return;
    const next = getNextIndex(currentIndex);
    if (next === currentIndex) return;
    editRevision.current += 1;
    setSaveState("pending");
    setCurrentIndex(next);
  };

  const handleStart = async () => {
    const questionOrder = activeQuestions.map(q => q.id);
    try {
      const attempt = await createAttempt({
        testId,
        questionOrder,
      });
      setAttemptId(attempt.id);
      resumeHandled.current = true;
      // Update URL with attempt ID for refresh support
      setLocation(`/test/${encodeURIComponent(testId)}?attempt=${attempt.id}`, { replace: true });
      setIsStarted(true);
    } catch (err) {
      toast({ title: "Error", description: "No se pudo iniciar el test", variant: "destructive" });
    }
  };

  const handleFinish = async () => {
    if (!attemptId || finalizeInFlight.current) return;
    finalizeInFlight.current = true;
    setFinalizeError(false);
    setSaveState("saving");
    if (autosaveTimeout.current) clearTimeout(autosaveTimeout.current);
    try {
      const result = await finalizeAttempt({ id: attemptId, answers: { ...answers } });
      persistedRevision.current = editRevision.current;
      setCompletedResult(result);
      setSaveState("saved");
      await removeHistoryGuard();
      setIsFinished(true);
    } catch {
      const refreshedAttempt = await refetchAttempt();
      if (refreshedAttempt.data?.status === "completed") {
        setAttemptId(refreshedAttempt.data.id);
        setAnswers(refreshedAttempt.data.answers as Record<number, string> || {});
        setIsStarted(true);
        setIsFinished(true);
        setSaveState("saved");
        await refreshCompletedResult(refreshedAttempt.data.id);
      } else {
        setSaveState("error");
        setFinalizeError(true);
      }
    } finally {
      finalizeInFlight.current = false;
    }
  };

  const handleSaveAndExit = async () => {
    if (!attemptId || saveExitInFlight.current || isFinalizing) return;
    saveExitInFlight.current = true;
    if (autosaveTimeout.current) clearTimeout(autosaveTimeout.current);
    const revision = editRevision.current;
    setSaveState("saving");
    try {
      await updateAttemptAsync({
        id: attemptId,
        currentIndex,
        answers: { ...answers },
      });
      if (revision !== editRevision.current) throw new Error("El estado del intento cambió mientras se guardaba.");
      persistedRevision.current = Math.max(persistedRevision.current, revision);
      if (revision === editRevision.current) setSaveState("saved");
      toast({ title: "Progreso Guardado", description: "Puedes continuar este test más tarde desde la página de Historial." });
      await navigateAfterSave("/results");
    } catch {
      setSaveState("error");
    } finally {
      saveExitInFlight.current = false;
    }
  };

  // Intro Screen
  if (!isStarted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/20">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full"
        >
          <Card className="p-8 shadow-xl">
            <div className="text-center mb-8 space-y-2">
              <h1 className="text-3xl font-display font-bold">{testId.replace('.json', '')}</h1>
              <p className="text-muted-foreground">{questions?.length ?? 0} Preguntas</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-3">
                  <Shuffle className="w-5 h-5 text-primary" />
                  <Label htmlFor="random" className="font-medium cursor-pointer">Orden Aleatorio</Label>
                </div>
                <Switch id="random" checked={randomize} onCheckedChange={setRandomize} data-testid="switch-randomize" />
              </div>

              <Button size="lg" className="w-full text-lg h-12" onClick={handleStart} data-testid="button-start-test">
                Comenzar Test
              </Button>
              
              <Button variant="ghost" className="w-full" onClick={() => setLocation("/")} data-testid="button-cancel">
                Cancelar
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Result Screen
  if (isFinished) {
    if (completedResultLookupError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-muted/20">
          <Card className="max-w-md w-full p-8 text-center space-y-5">
            <h2 className="text-2xl font-bold">No se pudo recuperar el resultado</h2>
            <p className="text-muted-foreground">El intento está finalizado y permanece bloqueado. Comprueba tu conexión e inténtalo de nuevo.</p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-home">Inicio</Button>
              <Button onClick={() => { if (attemptId) void refreshCompletedResult(attemptId); }} data-testid="button-retry-result">Reintentar</Button>
            </div>
          </Card>
        </div>
      );
    }

    if (completedResultMissing || !completedResult) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-muted/20">
          <Card className="max-w-md w-full p-8 text-center space-y-5">
            <h2 className="text-2xl font-bold">Resultado no disponible</h2>
            <p className="text-muted-foreground" data-testid="completed-result-unavailable">
              Este intento finalizado no tiene un resultado asociado. Puede ser un intento histórico anterior al registro de resultados enlazados; no recalculamos la puntuación para evitar mostrar un resultado distinto al confirmado.
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-home">Inicio</Button>
              <Button onClick={() => setLocation("/results")} data-testid="button-view-history">Ver Historial</Button>
            </div>
          </Card>
        </div>
      );
    }

    const score = completedResult?.score ?? 0;
    const isPass = score >= 50;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/20">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full text-center"
        >
          <Card className="p-8 shadow-xl border-t-8 border-t-primary">
            <div className="mb-6">
              <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center text-3xl font-bold border-4 ${isPass ? 'border-green-500 text-green-600 bg-green-50 dark:bg-green-900/30' : 'border-red-500 text-red-600 bg-red-50 dark:bg-red-900/30'}`}>
                {score}%
              </div>
            </div>
            
            <h2 className="text-2xl font-bold mb-2">{isPass ? "¡Buen Trabajo!" : "Sigue Practicando"}</h2>
            <p className="text-muted-foreground mb-8">
              Has respondido {completedResult?.correctCount ?? 0} de {completedResult?.totalQuestions ?? 0} correctamente.
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-home">
                <Home className="w-4 h-4 mr-2" /> Inicio
              </Button>
              <Button onClick={() => setLocation("/results")} data-testid="button-view-history">
                Ver Historial
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Safety check for currentQuestion
  if (!currentQuestion) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <h2 className="text-2xl font-bold mb-4">Error Cargando Pregunta</h2>
        <Button onClick={() => setLocation("/")}>Volver al Inicio</Button>
      </div>
    );
  }

  // Test Interface
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex-shrink-0 z-10 bg-background/80 backdrop-blur-md border-b">
        <div className="max-w-4xl mx-auto px-3 md:px-4 h-12 md:h-16 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleSaveAndExit} disabled={isFinalizing || saveExitInFlight.current} data-testid="button-save-exit" className="px-2 md:px-3">
            <Save className="w-4 h-4 md:mr-1" /> <span className="hidden md:inline">Guardar y Salir</span>
          </Button>
          <div className="font-mono font-medium text-sm text-muted-foreground">
            {currentIndex + 1} / {activeQuestions.length}
            <span className="hidden sm:inline ml-2 text-xs">({answeredCount} respondidas)</span>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground px-2" data-testid="button-flag">
            <Flag className="w-4 h-4" />
          </Button>
        </div>
        <div role="status" aria-live="polite" data-testid="attempt-save-status" className="max-w-4xl mx-auto px-4 min-h-6 text-xs text-muted-foreground">
          {saveState === "pending" && "Cambios pendientes de guardar…"}
          {saveState === "saving" && (isFinalizing ? "Finalizando y guardando el resultado…" : "Guardando…")}
          {saveState === "saved" && "Guardado"}
          {saveState === "error" && (finalizeError
            ? "No se pudo finalizar. Tus respuestas siguen aquí; inténtalo de nuevo."
            : "No se pudo guardar. Tus respuestas siguen aquí; vuelve a guardar para reintentar.")}
        </div>
        <Progress value={progress} className="h-1 rounded-none" />
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 container max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-8 flex flex-col justify-center overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQuestion.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0"
          >
            <QuestionCard
              question={currentQuestion}
              selectedAnswer={answers[currentQuestion.id] || null}
              onSelectAnswer={handleAnswer}
              showFeedback={!!answers[currentQuestion.id]}
              disabled={saveExitInFlight.current}
              compact
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Nav */}
      <div className="flex-shrink-0 border-t bg-background/95 backdrop-blur-md pt-3 pb-6 md:py-6 safe-area-pb">
        <div className="max-w-4xl mx-auto px-4 md:px-4 flex justify-between items-center gap-4 mb-4 md:mb-0">
          <Button 
            variant="ghost" 
            onClick={() => changeIndex(prev => Math.max(0, prev - 1))}
            disabled={currentIndex === 0 || isFinalizing || saveExitInFlight.current}
            data-testid="button-previous"
            className="h-12 px-4 md:px-6 rounded-xl disabled:opacity-40 bg-muted/50 hover:bg-muted"
          >
            <ChevronLeft className="w-5 h-5 mr-1" /> 
            <span className="text-sm font-medium">Anterior</span>
          </Button>

          {currentIndex === activeQuestions.length - 1 ? (
            <Button 
              onClick={handleFinish}
              disabled={isFinalizing || saveExitInFlight.current}
              className="h-12 px-8 md:px-10 rounded-xl bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/30 text-base font-semibold" 
              data-testid="button-finish"
            >
              Finalizar
            </Button>
          ) : (
            <Button 
              onClick={() => changeIndex(prev => prev + 1)}
              disabled={isFinalizing || saveExitInFlight.current}
              className="h-12 px-6 md:px-10 rounded-xl shadow-lg shadow-primary/30 text-base font-semibold"
              data-testid="button-next"
            >
              <span>Siguiente</span>
              <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
