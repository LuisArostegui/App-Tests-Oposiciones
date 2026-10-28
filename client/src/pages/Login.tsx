import { useState } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogIn, User, Lock, Loader2 } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { login, isLoggingIn } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const requestedReturnTo = new URLSearchParams(searchString).get("returnTo");
  const returnTo = requestedReturnTo?.startsWith("/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await login({ username, password });
      toast({
        title: "Bienvenido",
        description: "Has iniciado sesión correctamente",
      });
      setLocation(returnTo);
    } catch (err: any) {
      const message = err?.message || "Error al iniciar sesión";
      toast({
        variant: "destructive",
        title: "Error",
        description: message,
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen flex items-center justify-center p-4"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"
          >
            <LogIn className="h-8 w-8 text-primary" />
          </motion.div>
          <CardTitle className="text-2xl">Iniciar Sesión</CardTitle>
          <CardDescription>
            Accede a tu cuenta para ver tus tests
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuario</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="Tu nombre de usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-username"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  data-testid="input-password"
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isLoggingIn}
              data-testid="button-login"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Iniciando sesión...
                </>
              ) : (
                "Iniciar Sesión"
              )}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              ¿No tienes cuenta?{" "}
              <Link href="/register" className="text-primary hover:underline" data-testid="link-register">
                Regístrate
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  );
}
