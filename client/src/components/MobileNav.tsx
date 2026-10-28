import { Link, useLocation } from "wouter";
import { buildTestUrl } from "@shared/routes";
import { Home, BarChart3, Settings, Plus, Play, LogOut } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ImportDialog } from "@/components/ImportDialog";
import { useAttempts } from "@/hooks/use-attempts";
import { useAuth } from "@/hooks/use-auth";
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

interface NavItem {
  href: string;
  icon: typeof Home;
  label: string;
}

const navItems: NavItem[] = [
  { href: "/", icon: Home, label: "Inicio" },
  { href: "/results", icon: BarChart3, label: "Historial" },
];

export function MobileNav() {
  const [location, setLocation] = useLocation();
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const { data: attempts } = useAttempts();
  const { logout, isLoggingOut } = useAuth();

  const inProgressAttempts = attempts?.filter(a => a.status === "in_progress") || [];
  const latestAttempt = inProgressAttempts.length > 0 
    ? inProgressAttempts.sort((a, b) => 
        new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
      )[0]
    : null;

  const isActiveRoute = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  const handlePlayClick = () => {
    if (latestAttempt) {
      setShowResumeDialog(true);
    } else {
      setLocation("/");
    }
  };

  const handleResume = () => {
    if (latestAttempt) {
      setLocation(buildTestUrl(latestAttempt.testId, latestAttempt.id));
    }
    setShowResumeDialog(false);
  };

  const handleNewTest = () => {
    setShowResumeDialog(false);
    setLocation("/");
  };

  return (
    <>
      <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Test en progreso</AlertDialogTitle>
            <AlertDialogDescription>
              Tienes un test sin terminar: <strong>{latestAttempt?.testId.replace('.json', '')}</strong>. 
              ¿Quieres continuarlo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleNewTest}>Nuevo test</AlertDialogCancel>
            <AlertDialogAction onClick={handleResume}>Continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 md:hidden"
        data-testid="mobile-nav"
      >
        <div className="flex items-center justify-around px-2 py-2 safe-area-pb relative">
          {/* Left side nav items */}
          {navItems.map((item) => {
            const isActive = isActiveRoute(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg transition-colors min-w-[64px]",
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
                aria-current={isActive ? "page" : undefined}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}

          {/* Center play button - floating above */}
          <button
            onClick={handlePlayClick}
            className="absolute left-1/2 -translate-x-1/2 -top-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:bg-primary/90 transition-all active:scale-95"
            data-testid="nav-start-test"
          >
            <Play className="h-6 w-6 ml-0.5" />
          </button>

          {/* Spacer for center button */}
          <div className="w-14" />

          {/* Right side items */}
          <Link
            href="/admin"
            className={cn(
              "flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg transition-colors min-w-[64px]",
              isActiveRoute("/admin")
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            data-testid="nav-admin"
            aria-current={isActiveRoute("/admin") ? "page" : undefined}
          >
            <Settings className="h-5 w-5" />
            <span className="text-xs font-medium">Admin</span>
          </Link>

          {/* Logout button */}
          <button
            onClick={() => logout()}
            disabled={isLoggingOut}
            className="flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50 min-w-[64px]"
            data-testid="nav-logout"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-xs font-medium">Salir</span>
          </button>
        </div>
      </nav>
    </>
  );
}
