import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn, clearPrivateQueryData, beginPrivateSessionTransition, finishPrivateSessionTransition, recoverInterruptedSessionTransitions, setSessionTransition, isSessionTransitioning } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { usePrivateMutation } from "@/hooks/use-private-mutation";

interface User {
  id: number;
  username: string;
}

interface LoginData {
  username: string;
  password: string;
}

interface RegisterData {
  username: string;
  password: string;
}

export function useAuth() {
  const [, setLocation] = useLocation();
  const [sessionVersion, setSessionVersion] = useState(0);

  useEffect(() => {
    const handleSessionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ transitioning?: boolean }>).detail;
      if (detail?.transitioning !== undefined) setSessionTransition(detail.transitioning);
      setSessionVersion((version) => version + 1);
    };
    window.addEventListener("opostest:session-changed", handleSessionChange);
    return () => window.removeEventListener("opostest:session-changed", handleSessionChange);
  }, []);

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/me", sessionVersion],
    queryFn: async (context) => isSessionTransitioning()
      ? recoverInterruptedSessionTransitions(async () => await getQueryFn<User>({ on401: "returnNull" })({ ...context, queryKey: ["/api/auth/me"] }))
      : getQueryFn<User>({ on401: "returnNull" })({ ...context, queryKey: ["/api/auth/me"] }),
    retry: false,
    staleTime: Infinity,
    refetchInterval: () => isSessionTransitioning() ? 5_000 : false,
  });

  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (isSessionTransitioning()) {
      if (user === null) wasAuthenticated.current = false;
      return;
    }
    if (user) {
      wasAuthenticated.current = true;
    } else if (user === null && wasAuthenticated.current) {
      wasAuthenticated.current = false;
      void clearPrivateQueryData();
    }
  }, [user]);

  const loginMutation = usePrivateMutation({
    meta: { sessionTransition: true },
    onMutate: () => beginPrivateSessionTransition(),
    mutationFn: async (data: LoginData) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: async (_data, _variables, transitionId) => {
      await finishPrivateSessionTransition(transitionId);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: async (_error, _variables, transitionId) => {
      await finishPrivateSessionTransition(transitionId);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const registerMutation = usePrivateMutation({
    meta: { sessionTransition: true },
    onMutate: () => beginPrivateSessionTransition(),
    mutationFn: async (data: RegisterData) => {
      const res = await apiRequest("POST", "/api/auth/register", data);
      return res.json();
    },
    onSuccess: async (_data, _variables, transitionId) => {
      await finishPrivateSessionTransition(transitionId);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: async (_error, _variables, transitionId) => {
      await finishPrivateSessionTransition(transitionId);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logoutMutation = usePrivateMutation({
    meta: { sessionTransition: true },
    onMutate: () => beginPrivateSessionTransition(),
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout", {});
      return res.json();
    },
    onSuccess: async (_data, _variables, transitionId) => {
      await finishPrivateSessionTransition(transitionId);
      setLocation("/login");
    },
    onError: async (_error, _variables, transitionId) => {
      await finishPrivateSessionTransition(transitionId);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    isLoggingIn: loginMutation.isPending,
    register: registerMutation.mutateAsync,
    registerError: registerMutation.error,
    isRegistering: registerMutation.isPending,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
