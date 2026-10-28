export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function throwApiError(response: Response): Promise<never> {
  let message = "";
  try {
    const body = await response.json() as { message?: unknown };
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Keep the status even when the server did not return a JSON error body.
  }
  throw new ApiError(response.status, message || `Error HTTP ${response.status}`);
}

export function getLoadErrorMessage(error: unknown, resource: "test" | "attempt"): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "La sesión ha caducado. Inicia sesión y vuelve a este mismo intento.";
    if (error.status === 404) return resource === "attempt"
      ? "Este intento no existe o no pertenece a tu cuenta. La referencia se ha conservado."
      : "Este test ya no está disponible para tu cuenta.";
    if (error.status === 409) return error.message || "El estado del recurso ha cambiado. Actualízalo antes de continuar.";
    if (error.status >= 500) return "El servidor no pudo cargar este recurso. Vuelve a intentarlo.";
    return error.message;
  }
  if (error instanceof TypeError) return "No se pudo conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.";
  return "Ocurrió un error al cargar este recurso. Vuelve a intentarlo.";
}
