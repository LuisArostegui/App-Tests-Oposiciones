import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { capturePrivateSessionEpoch, isPrivateSessionEpochCurrent } from "@/lib/queryClient";

interface PrivateMutationContext<TContext> {
  sessionEpoch: number;
  userContext: TContext | undefined;
}

export function usePrivateMutation<TData, TError = Error, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  return useMutation(withPrivateMutationCallbacks(
    options,
    capturePrivateSessionEpoch,
    (epoch) => options.meta?.sessionTransition === true || isPrivateSessionEpochCurrent(epoch),
  ));
}

export function withPrivateMutationCallbacks<TData, TError, TVariables, TContext>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
  getEpoch: () => number,
  isCurrent: (epoch: number) => boolean,
): UseMutationOptions<TData, TError, TVariables, PrivateMutationContext<TContext>> {
  return {
    ...options,
    onMutate: async (variables) => ({
      userContext: await options.onMutate?.(variables),
      sessionEpoch: getEpoch(),
    }),
    onSuccess: async (data, variables, context) => {
      if (!context || !isCurrent(context.sessionEpoch)) return;
      await options.onSuccess?.(data, variables, context.userContext as TContext);
    },
    onError: async (error, variables, context) => {
      if (!context || !isCurrent(context.sessionEpoch)) return;
      await options.onError?.(error, variables, context.userContext);
    },
    onSettled: async (data, error, variables, context) => {
      if (!context || !isCurrent(context.sessionEpoch)) return;
      await options.onSettled?.(data, error, variables, context.userContext);
    },
  };
}
