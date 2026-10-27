import { z } from 'zod';
import { insertQuestionSchema, insertResultSchema, insertAttemptSchema, updateQuestionSchema, updateAttemptSchema, questions, results, testAttempts } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
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
        filename: z.string(),
        content: z.array(z.any()),
      }),
      responses: {
        201: z.object({ success: z.boolean(), count: z.number() }),
        400: errorSchemas.validation,
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
      },
    },
    rename: {
      method: 'PUT' as const,
      path: '/api/tests/:id/rename',
      input: z.object({
        newName: z.string().min(1),
      }),
      responses: {
        200: z.object({ success: z.boolean(), newId: z.string() }),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
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
    create: {
      method: 'POST' as const,
      path: '/api/results',
      input: insertResultSchema,
      responses: {
        201: z.custom<typeof results.$inferSelect>(),
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
        questionOrder: z.array(z.number()),
        totalQuestions: z.number(),
      }),
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
        200: z.array(z.string()),
        400: errorSchemas.validation,
      },
    },
    fetch: {
      method: 'GET' as const,
      path: '/api/remote/fetch',
      input: z.object({ url: z.string(), filename: z.string() }).optional(),
      responses: {
        200: z.array(z.any()),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`:${key}`, String(value));
    });
  }
  return url;
}
