import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useTests, useDeleteTest, useRenameTest } from "@/hooks/use-tests";
import { ImportDialog } from "@/components/ImportDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { FileText, BarChart3, ChevronRight, Trash2, Pencil, Edit3, LogOut, User } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { buildTestUrl, buildUrl } from "@shared/routes";

export default function Home() {
  const { data: tests, isLoading: loadingTests } = useTests();
  const { user, logout, isLoggingOut } = useAuth();
  const [, navigate] = useLocation();
  const { mutate: deleteTest, isPending: isDeleting } = useDeleteTest();
  const { mutate: renameTest, isPending: isRenaming } = useRenameTest();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [newTestName, setNewTestName] = useState("");

  const handleDeleteClick = (testId: string) => {
    // Forzar la limpieza del pointer-events
    document.body.style.pointerEvents = '';
    setSelectedTest(testId);
    setDeleteDialogOpen(true);
  };

  const handleRenameClick = (testId: string) => {
    // Forzar la limpieza del pointer-events
    document.body.style.pointerEvents = '';
    setSelectedTest(testId);
    setNewTestName(testId.replace('.json', ''));
    setRenameDialogOpen(true);
  };

  const handleEditClick = (testId: string) => {
    // Forzar la limpieza del pointer-events
    document.body.style.pointerEvents = '';
    navigate(buildUrl("/admin?test=:id", { id: testId }));
  };

  const confirmDelete = () => {
    if (selectedTest) {
      deleteTest(selectedTest, {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setSelectedTest(null);
        },
      });
    }
  };

  const confirmRename = () => {
    if (selectedTest && newTestName.trim()) {
      renameTest(
        { testId: selectedTest, newName: newTestName.trim() },
        {
          onSuccess: () => {
            setRenameDialogOpen(false);
            setSelectedTest(null);
            setNewTestName("");
          },
        }
      );
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between pb-6 border-b border-border">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-4xl font-display font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              OposTest Pro
            </h1>
            <p className="text-muted-foreground font-medium">Plataforma de Preparación de Oposiciones</p>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {user && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{user.username}</span>
              </div>
            )}
            <Link href="/results">
              <Button variant="outline" className="gap-2 hidden sm:flex">
                <BarChart3 className="w-4 h-4" /> Historial
              </Button>
            </Link>
            <ThemeToggle />
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => logout()}
              disabled={isLoggingOut}
              title="Cerrar sesión"
              data-testid="button-logout"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content: Local Tests */}
          <div className="lg:col-span-2 space-y-6 max-h-[60vh] md:max-h-none overflow-y-auto md:overflow-visible">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight shrink-0">Tu Biblioteca</h2>
              <ImportDialog />
            </div>

            {loadingTests ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-32 bg-muted/50 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : tests?.length === 0 ? (
              <Card className="border-dashed border-2 bg-muted/20">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                    <FileText className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium">No hay tests importados</h3>
                    <p className="text-muted-foreground">Importa un archivo JSON guardado en tu dispositivo para empezar.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {tests?.map((test, index) => (
                  <motion.div
                    key={test.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <Link href={buildTestUrl(test.id)} className="group block h-full" data-testid={`link-test-${test.id}`}>
                          <Card className="h-full hover:shadow-xl hover:border-primary/50 transition-all duration-300 overflow-hidden relative">
                            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <CardHeader>
                              <div className="flex justify-between items-start mb-2">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                  <FileText className="w-5 h-5" />
                                </div>
                                <Badge variant="secondary" className="font-mono text-xs">
                                  {test.count} Preg.
                                </Badge>
                              </div>
                              <CardTitle className="line-clamp-2 text-lg group-hover:text-primary transition-colors">
                                {test.id.replace('.json', '')}
                              </CardTitle>
                              <CardDescription className="line-clamp-1">
                                {test.category || "Categoría General"}
                              </CardDescription>
                            </CardHeader>
                            <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all">
                              <ChevronRight className="w-5 h-5 text-primary" />
                            </div>
                          </Card>
                        </Link>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setTimeout(() => handleEditClick(test.id), 100);
                          }}
                          className="cursor-pointer"
                          data-testid={`menu-edit-${test.id}`}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          Editar
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setTimeout(() => handleRenameClick(test.id), 100);
                          }}
                          className="cursor-pointer"
                          data-testid={`menu-rename-${test.id}`}
                        >
                          <Edit3 className="w-4 h-4 mr-2" />
                          Cambiar nombre
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setTimeout(() => handleDeleteClick(test.id), 100);
                          }}
                          className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                          data-testid={`menu-delete-${test.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Eliminar
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Remote imports are disabled until an administrator allowlist is implemented. */}
          <div className="space-y-6 max-h-[50vh] md:max-h-none overflow-y-auto md:overflow-visible">
            <h2 className="text-2xl font-semibold tracking-tight">Servidor Remoto</h2>
            <Card className="border-muted bg-card shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Descargas remotas desactivadas</CardTitle>
                <CardDescription>Para proteger el servidor, la importación desde direcciones de red no está disponible.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Puedes seguir importando archivos JSON guardados en tu dispositivo.</p>
              </CardContent>
            </Card>
            
            <Link href="/admin" className="hidden md:block">
              <Button variant="ghost" className="w-full text-muted-foreground hover:text-foreground" data-testid="link-admin">
                Ir al Panel de Administración
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar Test?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el test "{selectedTest?.replace('.json', '')}" y todas sus preguntas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting} data-testid="button-cancel-delete">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar Nombre</DialogTitle>
            <DialogDescription>
              Introduce el nuevo nombre para el test.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newName">Nuevo nombre</Label>
              <Input
                id="newName"
                value={newTestName}
                onChange={(e) => setNewTestName(e.target.value)}
                placeholder="Nombre del test"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTestName.trim()) {
                    confirmRename();
                  }
                }}
                data-testid="input-new-test-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)} disabled={isRenaming} data-testid="button-cancel-rename">
              Cancelar
            </Button>
            <Button onClick={confirmRename} disabled={isRenaming || !newTestName.trim()} data-testid="button-confirm-rename">
              {isRenaming ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
