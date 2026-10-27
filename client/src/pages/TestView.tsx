import { useEffect, useState, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useTest } from "@/hooks/use-tests";
import { useCreateResult } from "@/hooks/use-results";
import { useAttempt, useCreateAttempt, useUpdateAttempt } from "@/hooks/use-attempts";
import { QuestionCard } from "@/components/QuestionCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Flag, Shuffle, Home, Save } from "lucide-react";
import { type Question } from "@shared/schema";
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
  const { mutate: saveResult } = useCreateResult();
  const { mutateAsync: createAttempt } = useCreateAttempt();
  const { mutate: updateAttempt } = useUpdateAttempt();
  const { data: existingAttempt, isLoading: attemptLoading, isError: attemptError } = useAttempt(attemptIdParam ? Number(attemptIdParam) : null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [randomize, setRandomize] = useState(false);
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [attemptLoadFailed, setAttemptLoadFailed] = useState(false);
  const resumeHandled = useRef(false);

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
    if (existingAttempt && questions && !resumeHandled.current) {
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
  }, [existingAttempt, questions, toast, setLocation, testId]);

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
    if (attemptId && isStarted && !isFinished) {
      const timeout = setTimeout(() => {
        updateAttempt({
          id: attemptId,
          currentIndex,
          answers: answers as Record<string, string>,
        });
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [currentIndex, answers, attemptId, isStarted, isFinished, updateAttempt]);

  const isLoadingState = isLoading || (attemptIdParam && attemptLoading && !attemptLoadFailed);
  
  if (isLoadingState) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground animate-pulse">Cargando test...</p>
      </div>
    </div>
  );

  if (!questions || questions.length === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <h2 className="text-2xl font-bold mb-4">Test No Encontrado</h2>
      <Button onClick={() => setLocation("/")}>Volver al Inicio</Button>
    </div>
  );

  // Safety check - if activeQuestions is empty but we have questions, initialize
  if (activeQuestions.length === 0 && questions.length > 0) {
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
    if (currentQuestion) {
      setAnswers(prev => ({ ...prev, [currentQuestion.id]: key }));
    }
  };

  const calculateScore = () => {
    if (activeQuestions.length === 0) return 0;
    let correct = 0;
    activeQuestions.forEach(q => {
      if (answers[q.id] === q.correctAnswer) correct++;
    });
    return Math.round((correct / activeQuestions.length) * 100);
  };

  const handleStart = async () => {
    const questionOrder = activeQuestions.map(q => q.id);
    try {
      const attempt = await createAttempt({
        testId,
        questionOrder,
      });
      setAttemptId(attempt.id);
      // Update URL with attempt ID for refresh support
      setLocation(`/test/${encodeURIComponent(testId)}?attempt=${attempt.id}`, { replace: true });
      setIsStarted(true);
    } catch (err) {
      toast({ title: "Error", description: "No se pudo iniciar el test", variant: "destructive" });
    }
  };

  const handleFinish = () => {
    const score = calculateScore();
    const correctCount = activeQuestions.filter(q => answers[q.id] === q.correctAnswer).length;
    
    // Mark attempt as completed
    if (attemptId) {
      updateAttempt({
        id: attemptId,
        status: "completed",
        correctCount,
        score,
        answers: answers as Record<string, string>,
        currentIndex: activeQuestions.length - 1,
      });
    }
    
    saveResult({
      testId,
      score,
      correctCount,
      totalQuestions: activeQuestions.length
    });
    
    setIsFinished(true);
  };

  const handleSaveAndExit = () => {
    if (attemptId) {
      updateAttempt({
        id: attemptId,
        currentIndex,
        answers: answers as Record<string, string>,
      });
      toast({ title: "Progreso Guardado", description: "Puedes continuar este test más tarde desde la página de Historial." });
    }
    setLocation("/results");
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
              <p className="text-muted-foreground">{questions.length} Preguntas</p>
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
    const score = calculateScore();
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
              Has respondido {activeQuestions.filter(q => answers[q.id] === q.correctAnswer).length} de {activeQuestions.length} correctamente.
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
          <Button variant="ghost" size="sm" onClick={handleSaveAndExit} data-testid="button-save-exit" className="px-2 md:px-3">
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
            onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
            data-testid="button-previous"
            className="h-12 px-4 md:px-6 rounded-xl disabled:opacity-40 bg-muted/50 hover:bg-muted"
          >
            <ChevronLeft className="w-5 h-5 mr-1" /> 
            <span className="text-sm font-medium">Anterior</span>
          </Button>

          {currentIndex === activeQuestions.length - 1 ? (
            <Button 
              onClick={handleFinish} 
              className="h-12 px-8 md:px-10 rounded-xl bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/30 text-base font-semibold" 
              data-testid="button-finish"
            >
              Finalizar
            </Button>
          ) : (
            <Button 
              onClick={() => setCurrentIndex(prev => prev + 1)}
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
