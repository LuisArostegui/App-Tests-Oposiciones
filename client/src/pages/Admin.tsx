import { useTests, useTest, useDeleteQuestion } from "@/hooks/use-tests";
import { Link, useLocation, useSearch } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { EditQuestionDialog } from "@/components/EditQuestionDialog";
import { ArrowLeft, Trash2, Plus, FileText, Search, BookOpen, Check, X, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { buildUrl } from "@shared/routes";

export default function Admin() {
  const { data: tests } = useTests();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { logout, isLoggingOut } = useAuth();
  const [selectedTestId, setSelectedTestId] = useState<string>(() => new URLSearchParams(searchString).get("test") ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  
  const { data: questions, isLoading } = useTest(selectedTestId);
  const { mutate: deleteQuestion } = useDeleteQuestion();

  const filteredQuestions = questions?.filter(q => 
    q.questionText.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedTest = tests?.find(t => t.id === selectedTestId);

  const selectTest = (testId: string) => {
    setSelectedTestId(testId);
    setLocation(testId ? buildUrl("/admin?test=:id", { id: testId }) : "/admin");
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href="/" data-testid="button-back-home">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-display font-bold">Gestor de Preguntas</h1>
            <p className="text-sm text-muted-foreground hidden md:block">Crea, edita y organiza las preguntas de tus tests</p>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => logout()}
            disabled={isLoggingOut}
            title="Cerrar sesión"
            data-testid="button-logout-admin"
            className="hidden md:flex"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Seleccionar Test
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedTestId} onValueChange={selectTest}>
                  <SelectTrigger data-testid="select-test">
                    <SelectValue placeholder="Elige un test..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tests?.map(test => (
                      <SelectItem key={test.id} value={test.id}>
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-[180px]">{test.id.replace('.json', '')}</span>
                          <Badge variant="secondary" className="ml-auto text-xs">{test.count}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {selectedTest && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    Info del Test
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Preguntas</span>
                    <span className="font-medium">{selectedTest.count}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Categoría</span>
                    <span className="font-medium">{selectedTest.category || "General"}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="lg:col-span-3">
            {!selectedTestId ? (
              <Card className="h-[400px] flex items-center justify-center">
                <div className="text-center space-y-3 p-8">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <FileText className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold">Ningún Test Seleccionado</h3>
                  <p className="text-muted-foreground text-sm max-w-xs">
                    Elige un test de la barra lateral para ver y gestionar sus preguntas.
                  </p>
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-card">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg" data-testid="admin-selected-test">{selectedTestId.replace('.json', '')}</CardTitle>
                      <CardDescription>{filteredQuestions?.length || 0} preguntas</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-end">
                      <div className="relative flex-1 min-w-[140px] max-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input 
                          placeholder="Buscar..." 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 w-full"
                          data-testid="input-search-questions"
                        />
                      </div>
                      <EditQuestionDialog 
                        mode="create" 
                        testId={selectedTestId}
                        trigger={
                          <Button size="sm" data-testid="button-add-new-question" className="shrink-0">
                            <Plus className="w-4 h-4 md:mr-2" />
                            <span className="hidden md:inline">Añadir Pregunta</span>
                          </Button>
                        }
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="p-8 text-center">
                      <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-sm text-muted-foreground mt-3">Cargando preguntas...</p>
                    </div>
                  ) : filteredQuestions?.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-muted-foreground">
                        {searchQuery ? "No hay preguntas que coincidan con tu búsqueda." : "No hay preguntas en este test todavía."}
                      </p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[calc(100vh-320px)]">
                      <div className="divide-y">
                        <AnimatePresence mode="popLayout">
                          {filteredQuestions?.map((q, index) => (
                            <motion.div
                              key={q.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: -20 }}
                              transition={{ duration: 0.2, delay: index * 0.02 }}
                              className="p-4 hover:bg-muted/50 transition-colors group"
                            >
                              <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                  {index + 1}
                                </div>
                                
                                <div className="flex-1 min-w-0 space-y-3">
                                  <p className="text-sm font-medium leading-relaxed line-clamp-3" data-testid={`text-question-${q.id}`}>
                                    {q.questionText}
                                  </p>
                                  
                                  <div className="flex flex-wrap gap-2">
                                    {Object.entries(q.answers as Record<string, string>).sort().map(([key, value]) => (
                                      <Badge 
                                        key={key}
                                        variant={key === q.correctAnswer ? "default" : "outline"}
                                        className={cn(
                                          "text-xs font-normal max-w-[200px] truncate",
                                          key === q.correctAnswer && "bg-green-500 hover:bg-green-600"
                                        )}
                                      >
                                        {key === q.correctAnswer && <Check className="w-3 h-3 mr-1" />}
                                        <span className="font-semibold mr-1">{key}:</span>
                                        <span className="truncate">{value}</span>
                                      </Badge>
                                    ))}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <EditQuestionDialog question={q} mode="edit" />
                                  
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        data-testid={`button-delete-${q.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>¿Eliminar Pregunta?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Esta acción no se puede deshacer. La pregunta será eliminada permanentemente de este test.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction 
                                          onClick={() => deleteQuestion(q.id)} 
                                          className="bg-destructive hover:bg-destructive/90"
                                          data-testid={`button-confirm-delete-${q.id}`}
                                        >
                                          Eliminar
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
