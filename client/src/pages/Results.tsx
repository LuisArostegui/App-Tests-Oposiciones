import { useState } from "react";
import { useResults } from "@/hooks/use-results";
import { useAttempts, useDeleteAttempt } from "@/hooks/use-attempts";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft, Trophy, Calendar, CheckCircle, Play, Trash2, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { buildTestUrl } from "@shared/routes";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Results() {
  const { data: results, isLoading: resultsLoading } = useResults();
  const { data: attempts, isLoading: attemptsLoading } = useAttempts();
  const { mutate: deleteAttempt } = useDeleteAttempt();
  const [, setLocation] = useLocation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [attemptToDelete, setAttemptToDelete] = useState<{ id: number; testId: string } | null>(null);

  const inProgressAttempts = attempts?.filter(a => a.status === "in_progress") || [];
  
  // The API returns newest results first; chart the newest ten chronologically.
  const chartData = results?.slice(0, 10).reverse().map((r, i) => ({
    name: `Test ${i + 1}`,
    score: r.score,
    date: r.completedAt,
    testId: r.testId
  }));

  const averageScore = results?.length 
    ? Math.round(results.reduce((acc, curr) => acc + curr.score, 0) / results.length) 
    : 0;

  const isLoading = resultsLoading || attemptsLoading;

  const handleContinue = (attempt: typeof inProgressAttempts[0]) => {
    setLocation(buildTestUrl(attempt.testId, attempt.id));
  };

  const handleDeleteAttempt = (id: number, testId: string) => {
    setAttemptToDelete({ id, testId });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (attemptToDelete) {
      deleteAttempt(attemptToDelete.id);
    }
    setDeleteDialogOpen(false);
    setAttemptToDelete(null);
  };

  return (
    <>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar intento</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres eliminar este intento de <strong>{attemptToDelete?.testId.replace('.json', '')}</strong>? 
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <header className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-3xl font-display font-bold">Tu Progreso</h1>
        </header>

        {isLoading ? (
          <div className="h-64 bg-muted animate-pulse rounded-2xl" />
        ) : (
          <>
            {/* Stats Cards - Always visible at top */}
            <div className="sticky top-0 z-10 bg-background pt-2 pb-4 -mx-4 px-4 md:static md:mx-0 md:px-0 md:pt-0 md:pb-0 border-b md:border-b-0 border-border/50">
              <div className="grid grid-cols-3 gap-2 md:gap-6">
                <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                  <CardContent className="p-3 md:pt-6 md:p-6 flex flex-col items-center text-center">
                    <Trophy className="w-6 h-6 md:w-10 md:h-10 text-primary mb-1 md:mb-2" />
                    <h3 className="text-2xl md:text-4xl font-bold">{results?.length || 0}</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">Tests Completados</p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-3 md:pt-6 md:p-6 flex flex-col items-center text-center">
                    <div className="w-6 h-6 md:w-10 md:h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 mb-1 md:mb-2 font-bold text-xs md:text-base">%</div>
                    <h3 className="text-2xl md:text-4xl font-bold">{averageScore}%</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">Puntuación Media</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-3 md:pt-6 md:p-6 flex flex-col items-center text-center">
                    <CheckCircle className="w-6 h-6 md:w-10 md:h-10 text-blue-500 mb-1 md:mb-2" />
                    <h3 className="text-2xl md:text-4xl font-bold">
                      {results?.reduce((acc, curr) => acc + curr.correctCount, 0)}
                    </h3>
                    <p className="text-xs md:text-sm text-muted-foreground">Resp. Correctas</p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Scrollable content area */}
            <div className="space-y-8 pb-20 md:pb-0">
              {/* In Progress Section */}
              {inProgressAttempts.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-orange-500" />
                    <h2 className="text-xl md:text-2xl font-semibold">En Progreso</h2>
                    <Badge variant="secondary" className="ml-2">{inProgressAttempts.length}</Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {inProgressAttempts.map((attempt) => {
                      const answered = Object.keys(attempt.answers as Record<string, string> || {}).length;
                      const total = attempt.totalQuestions;
                      const progressPercent = Math.round((answered / total) * 100);
                      
                      return (
                        <Card key={attempt.id} className="border-orange-200 dark:border-orange-900/50 bg-orange-50/50 dark:bg-orange-900/10">
                          <CardContent className="pt-6">
                            <div className="flex items-start justify-between mb-4">
                              <div>
                                <h3 className="font-semibold text-lg">{attempt.testId.replace('.json', '')}</h3>
                                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                  <Calendar className="w-3 h-3" />
                                  {attempt.startedAt && format(new Date(attempt.startedAt), "d MMM yyyy, HH:mm", { locale: es })}
                                </p>
                              </div>
                              <Badge variant="outline" className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-300">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                En Progreso
                              </Badge>
                            </div>
                            
                            <div className="space-y-3">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Progreso</span>
                                <span className="font-medium">{answered} / {total} preguntas</span>
                              </div>
                              <div className="w-full bg-muted rounded-full h-2">
                                <div 
                                  className="bg-orange-500 h-2 rounded-full transition-all" 
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {total - answered} preguntas restantes
                              </div>
                            </div>
                            
                            <div className="flex gap-2 mt-4">
                              <Button 
                                className="flex-1" 
                                onClick={() => handleContinue(attempt)}
                                data-testid={`button-continue-${attempt.id}`}
                              >
                                <Play className="w-4 h-4 mr-2" /> Continuar
                              </Button>
                              <Button 
                                variant="outline" 
                                size="icon"
                                onClick={() => handleDeleteAttempt(attempt.id, attempt.testId)}
                                data-testid={`button-delete-attempt-${attempt.id}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Chart */}
            {results && results.length > 0 && (
              <Card className="p-6">
                <CardHeader className="px-0 pt-0">
                  <CardTitle>Historial de Puntuaciones</CardTitle>
                </CardHeader>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                      <YAxis stroke="var(--muted-foreground)" tick={{fontSize: 12}} domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'var(--card)', 
                          borderColor: 'var(--border)',
                          borderRadius: '8px' 
                        }} 
                      />
                      <Line 
                        type="monotone" 
                        dataKey="score" 
                        stroke="var(--primary)" 
                        strokeWidth={3}
                        dot={{ fill: 'var(--background)', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

              {/* History Table */}
              <div className="space-y-4">
                <h2 className="text-xl md:text-2xl font-semibold">Tests Completados</h2>
                {results && results.length > 0 ? (
                  <div className="border rounded-xl overflow-hidden bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nombre del Test</th>
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Puntuación</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden sm:table-cell">Correctas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {results?.map((result) => (
                          <tr key={result.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium">{result.testId.replace('.json', '')}</td>
                            <td className="px-4 py-3 text-muted-foreground flex items-center gap-2">
                              <Calendar className="w-3 h-3" />
                              {result.completedAt && format(new Date(result.completedAt), "d MMM yyyy", { locale: es })}
                            </td>
                            <td className="px-4 py-3 text-right font-bold">
                              <span className={result.score >= 50 ? "text-green-600" : "text-red-500"}>
                                {result.score}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                              {result.correctCount} / {result.totalQuestions}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Card className="p-8 text-center">
                    <p className="text-muted-foreground">No hay tests completados aún. ¡Empieza a practicar!</p>
                    <Link href="/">
                      <Button className="mt-4">Empezar un Test</Button>
                    </Link>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </>
  );
}
