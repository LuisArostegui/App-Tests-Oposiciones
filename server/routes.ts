import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { InsertQuestion, registerSchema, loginSchema } from "@shared/schema";
import { config } from "./config";
import { passport } from "./auth";
import { asyncHandler } from "./http-middleware";
import { parsePositiveId } from "./validation";
import { createAuthRateLimiter } from "./security-middleware";
import bcrypt from "bcryptjs";

import fs from "fs";
import path from "path";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "No autenticado" });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const registerRateLimit = createAuthRateLimiter(5, 60 * 60 * 1000);
  const loginRateLimit = createAuthRateLimiter(10, 15 * 60 * 1000);

  // === App Config (for frontend) ===
  app.get("/api/config", (req, res) => {
    res.json(config.app);
  });

  // === Auth Routes ===
  app.post("/api/auth/register", registerRateLimit, asyncHandler(async (req, res, next) => {
    try {
      const { username, password } = registerSchema.parse(req.body);
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "El usuario ya existe" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword });

      req.login({ id: user.id, username: user.username }, (err) => {
        if (err) return next(err);
        res.status(201).json({ id: user.id, username: user.username });
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  app.post("/api/auth/login", loginRateLimit, (req, res, next) => {
    try {
      loginSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Solicitud no válida" });
      }
      return next(err);
    }

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ message: "Credenciales incorrectas" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          return next(loginErr);
        }
        res.json({ id: user.id, username: user.username });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", requireAuth, (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          return next(destroyErr);
        }
        res.clearCookie("connect.sid", {
          httpOnly: true,
          secure: req.app.locals.secureSessionCookie === true,
          sameSite: "lax",
          path: "/",
        });
        res.json({ message: "Sesión cerrada" });
      });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated()) {
      res.json({ id: req.user!.id, username: req.user!.username });
    } else {
      res.status(401).json({ message: "No autenticado" });
    }
  });

  // === Tests (Protected) ===
  app.get(api.tests.list.path, requireAuth, asyncHandler(async (req, res) => {
    const tests = await storage.getTests(req.user!.id);
    res.json(tests);
  }));

  app.get(api.tests.get.path, requireAuth, asyncHandler(async (req, res) => {
    const testId = req.params.id;
    const questions = await storage.getQuestionsByTestId(testId, req.user!.id);
    if (!questions || questions.length === 0) {
      return res.status(404).json({ message: "Test not found" });
    }
    res.json(questions);
  }));

  app.delete(api.tests.delete.path, requireAuth, asyncHandler(async (req, res) => {
    const testId = req.params.id;
    const deleted = await storage.deleteTest(testId, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: "Test not found" });
    }
    res.status(204).send();
  }));

  app.put(api.tests.rename.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const oldTestId = req.params.id;
      const { newName } = api.tests.rename.input.parse(req.body);
      const newTestId = newName.endsWith('.json') ? newName : `${newName}.json`;
      const renamed = await storage.renameTest(oldTestId, newTestId, req.user!.id);
      if (!renamed) {
        return res.status(404).json({ message: "Test not found" });
      }
      res.json({ success: true, newId: newTestId });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  app.post(api.tests.import.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.tests.import.input.parse(req.body);
      
      const questionsToInsert: InsertQuestion[] = input.content.map((q: any) => ({
        testId: input.filename,
        questionText: q.pregunta,
        answers: q.respuestas,
        correctAnswer: q.respuesta_correcta,
        category: q.oposicion || "General",
      }));

      if (questionsToInsert.length === 0) {
        return res.status(400).json({ message: "No valid questions found in JSON" });
      }

      await storage.createQuestions(req.user!.id, questionsToInsert);
      
      res.status(201).json({ success: true, count: questionsToInsert.length });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  // === Questions (Protected) ===
  app.post(api.questions.create.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.questions.create.input.parse(req.body);
      const question = await storage.createQuestion(req.user!.id, input);
      res.status(201).json(question);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  app.put(api.questions.update.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (id === undefined) return res.status(400).json({ message: "Solicitud no válida" });
      const update = api.questions.update.input.parse(req.body);
      const updated = await storage.updateQuestion(id, req.user!.id, update);
      if (!updated) {
        return res.status(404).json({ message: "Question not found" });
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  app.delete(api.questions.delete.path, requireAuth, asyncHandler(async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (id === undefined) return res.status(400).json({ message: "Solicitud no válida" });
    const deleted = await storage.deleteQuestion(id, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: "Question not found" });
    }
    res.status(204).send();
  }));

  // === Results (Protected) ===
  app.get(api.results.list.path, requireAuth, asyncHandler(async (req, res) => {
    const results = await storage.getResults(req.user!.id);
    res.json(results);
  }));

  app.post(api.results.create.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.results.create.input.parse(req.body);
      const result = await storage.createResult(req.user!.id, input);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  // === Attempts (Protected) ===
  app.get(api.attempts.list.path, requireAuth, asyncHandler(async (req, res) => {
    const attempts = await storage.getAttempts(req.user!.id);
    res.json(attempts);
  }));

  app.get(api.attempts.get.path, requireAuth, asyncHandler(async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (id === undefined) return res.status(400).json({ message: "Solicitud no válida" });
    const attempt = await storage.getAttempt(id, req.user!.id);
    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    res.json(attempt);
  }));

  app.post(api.attempts.create.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.attempts.create.input.parse(req.body);
      const attempt = await storage.createAttempt({ ...input, userId: req.user!.id });
      if (!attempt) {
        return res.status(400).json({ message: "Validation error" });
      }
      res.status(201).json(attempt);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  app.put(api.attempts.update.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (id === undefined) return res.status(400).json({ message: "Solicitud no válida" });
      const update = api.attempts.update.input.parse(req.body);
      const updated = await storage.updateAttempt(id, req.user!.id, update);
      if (!updated) {
        return res.status(404).json({ message: "Attempt not found" });
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Solicitud no válida" });
      throw err;
    }
  }));

  app.delete(api.attempts.delete.path, requireAuth, asyncHandler(async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (id === undefined) return res.status(400).json({ message: "Solicitud no válida" });
    const deleted = await storage.deleteAttempt(id, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    res.status(204).send();
  }));

  // === Remote (Protected) ===
  app.get(api.remote.list.path, requireAuth, (_req, res) => {
    res.status(503).json({ message: "La importación remota no está disponible. Importa un archivo JSON local." });
  });

  app.get(api.remote.fetch.path, requireAuth, (_req, res) => {
    res.status(503).json({ message: "La importación remota no está disponible. Importa un archivo JSON local." });
  });
  return httpServer;
}
