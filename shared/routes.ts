import { z } from 'zod';
import { insertQuestionSchema, insertAttemptSchema, updateQuestionSchema, updateAttemptSchema, finalizeAttemptSchema, questions, results, testAttempts } from './schema';

const answerKeySchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
export const QUESTION_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const QUESTION_IMPORT_MAX_QUESTIONS = 1000;
// Each omitted category adds `,"oposicion":"General"` (22 UTF-8 bytes) after normalization.
export const QUESTION_IMPORT_NORMALIZATION_OVERHEAD_BYTES = QUESTION_IMPORT_MAX_QUESTIONS * 22;
export const QUESTION_IMPORT_MAX_CONTENT_BYTES = QUESTION_IMPORT_MAX_BYTES + QUESTION_IMPORT_NORMALIZATION_OVERHEAD_BYTES;
export const QUESTION_IMPORT_HTTP_WRAPPER_MAX_BYTES = 16 * 1024;
export const QUESTION_IMPORT_MAX_REQUEST_BYTES = QUESTION_IMPORT_MAX_CONTENT_BYTES + QUESTION_IMPORT_HTTP_WRAPPER_MAX_BYTES;
const importAnswersSchema = z.partialRecord(answerKeySchema, z.string().trim().min(1, 'no puede estar vacía').max(2000, 'supera los 2000 caracteres')).superRefine((answers, ctx) => {
  const count = Object.keys(answers).length;
  if (count < 2 || count > 8) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'debe incluir entre 2 y 8 respuestas', path: [] });
  }
});

export const questionImportItemSchema = z.object({
  pregunta: z.string().trim().min(1, 'no puede estar vacío').max(4000, 'supera los 4000 caracteres'),
  respuestas: importAnswersSchema,
  respuesta_correcta: answerKeySchema,
  oposicion: z.string().trim().min(1, 'no puede estar vacía').max(200, 'supera los 200 caracteres').default('General'),
}).strict().superRefine((question, ctx) => {
  if (!(question.respuesta_correcta in question.respuestas)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'debe corresponder a una respuesta existente',
      path: ['respuesta_correcta'],
    });
  }
});

export const questionImportContentSchema = z.array(questionImportItemSchema).min(1, 'debe incluir al menos una pregunta').max(QUESTION_IMPORT_MAX_QUESTIONS, 'no puede superar 1000 preguntas');

export const questionImportFilenameSchema = z.string().min(1, 'es obligatorio').max(150, 'no puede superar 150 caracteres')
  .refine((filename) => !/[\x00-\x1f\x7f]/.test(filename), 'no puede contener caracteres de control')
  .transform((filename) => filename.trim())
  .pipe(z.string().min(1, 'es obligatorio')
    .refine((filename) => filename.endsWith('.json') && !/[\/\\]/.test(filename), 'debe ser un nombre de archivo .json sin rutas'));

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
    errors: z.array(z.string()).optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  conflict: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  tests: {
    list: {
      method: 'GET' as const,
      path: '/api/tests',
      responses: {
        200: z.array(z.object({
          id: z.string(),
          count: z.number(),
          category: z.string().nullable(),
        })),
      },
    },
    import: {
      method: 'POST' as const,
      path: '/api/tests/import',
      input: z.object({
        filename: questionImportFilenameSchema,
        content: questionImportContentSchema,
      }).strict(),
      responses: {
        201: z.object({ success: z.boolean(), count: z.number() }),
        400: errorSchemas.validation,
        413: errorSchemas.validation,
        409: errorSchemas.conflict,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/tests/:id',
      responses: {
        200: z.array(z.custom<typeof questions.$inferSelect>()),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/tests/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        409: errorSchemas.conflict,
      },
    },
    rename: {
      method: 'PUT' as const,
      path: '/api/tests/:id/rename',
      input: z.object({
        newName: z.string().trim().min(1),
      }),
      responses: {
        200: z.object({ success: z.boolean(), newId: z.string() }),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        409: errorSchemas.conflict,
      },
    },
  },
  questions: {
    create: {
      method: 'POST' as const,
      path: '/api/questions',
      input: insertQuestionSchema,
      responses: {
        201: z.custom<typeof questions.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/questions/:id',
      input: updateQuestionSchema,
      responses: {
        200: z.custom<typeof questions.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/questions/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  results: {
    list: {
      method: 'GET' as const,
      path: '/api/results',
      responses: {
        200: z.array(z.custom<typeof results.$inferSelect>()),
      },
    },
  },
  attempts: {
    list: {
      method: 'GET' as const,
      path: '/api/attempts',
      responses: {
        200: z.array(z.custom<typeof testAttempts.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/attempts/:id',
      responses: {
        200: z.custom<typeof testAttempts.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/attempts',
      input: z.object({
        testId: z.string(),
        questionOrder: z.array(z.number().int().positive()).nonempty(),
      }).strict(),
      responses: {
        201: z.custom<typeof testAttempts.$inferSelect>(),
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/attempts/:id',
      input: updateAttemptSchema,
      responses: {
        200: z.custom<typeof testAttempts.$inferSelect>(),
        404: errorSchemas.notFound,
        409: errorSchemas.conflict,
      },
    },
    finalize: {
      method: 'POST' as const,
      path: '/api/attempts/:id/finalize',
      input: finalizeAttemptSchema,
      responses: {
        200: z.custom<typeof results.$inferSelect>(),
        404: errorSchemas.notFound,
        409: errorSchemas.conflict,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/attempts/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  remote: {
    list: {
      method: 'GET' as const,
      path: '/api/remote/list',
      input: z.object({ url: z.string() }).optional(),
      responses: {
        401: errorSchemas.validation,
        503: errorSchemas.internal,
      },
    },
    fetch: {
      method: 'GET' as const,
      path: '/api/remote/fetch',
      input: z.object({ url: z.string(), filename: z.string() }).optional(),
      responses: {
        401: errorSchemas.validation,
        503: errorSchemas.internal,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`:${key}`, encodeURIComponent(String(value)));
    });
  }
  return url;
}

export function buildTestUrl(testId: string, attemptId?: number): string {
  const path = buildUrl("/test/:id", { id: testId });
  return attemptId === undefined ? path : `${path}?${new URLSearchParams({ attempt: String(attemptId) })}`;
}

export function decodeTestIdFromPathname(pathname: string): string {
  const match = pathname.match(/^\/test\/([^/]+)\/?$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
