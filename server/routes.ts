import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { InsertQuestion, registerSchema, loginSchema } from "@shared/schema";
import fetch from "node-fetch";
import { config } from "./config";
import { passport } from "./auth";
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

  // === App Config (for frontend) ===
  app.get("/api/config", (req, res) => {
    res.json(config.app);
  });

  // === Auth Routes ===
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password } = registerSchema.parse(req.body);
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "El usuario ya existe" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword });

      req.login({ id: user.id, username: user.username }, (err) => {
        if (err) {
          return res.status(500).json({ message: "Error al iniciar sesión" });
        }
        res.status(201).json({ id: user.id, username: user.username });
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Register error:", err);
      res.status(500).json({ message: "Error al registrar" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    try {
      loginSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
    }

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: "Error al iniciar sesión" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Credenciales incorrectas" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Error al iniciar sesión" });
        }
        res.json({ id: user.id, username: user.username });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Error al cerrar sesión" });
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          return res.status(500).json({ message: "Error al cerrar sesión" });
        }
        res.clearCookie("connect.sid");
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
  app.get(api.tests.list.path, requireAuth, async (req, res) => {
    const tests = await storage.getTests(req.user!.id);
    res.json(tests);
  });

  app.get(api.tests.get.path, requireAuth, async (req, res) => {
    const testId = req.params.id;
    const questions = await storage.getQuestionsByTestId(testId, req.user!.id);
    if (!questions || questions.length === 0) {
      return res.status(404).json({ message: "Test not found" });
    }
    res.json(questions);
  });

  app.delete(api.tests.delete.path, requireAuth, async (req, res) => {
    const testId = req.params.id;
    const deleted = await storage.deleteTest(testId, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: "Test not found" });
    }
    res.status(204).send();
  });

  app.put(api.tests.rename.path, requireAuth, async (req, res) => {
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
      console.error("Rename error:", err);
      res.status(400).json({ message: "Invalid data" });
    }
  });

  app.post(api.tests.import.path, requireAuth, async (req, res) => {
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
      console.error("Import error:", err);
      res.status(400).json({ message: "Invalid data format" });
    }
  });

  // === Questions (Protected) ===
  app.post(api.questions.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.questions.create.input.parse(req.body);
      const question = await storage.createQuestion(req.user!.id, input);
      res.status(201).json(question);
    } catch (err) {
      console.error("Create question error:", err);
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.put(api.questions.update.path, requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const update = api.questions.update.input.parse(req.body);
      const updated = await storage.updateQuestion(id, req.user!.id, update);
      if (!updated) {
        return res.status(404).json({ message: "Question not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.delete(api.questions.delete.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const deleted = await storage.deleteQuestion(id, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: "Question not found" });
    }
    res.status(204).send();
  });

  // === Results (Protected) ===
  app.get(api.results.list.path, requireAuth, async (req, res) => {
    const results = await storage.getResults(req.user!.id);
    res.json(results);
  });

  app.post(api.results.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.results.create.input.parse(req.body);
      const result = await storage.createResult(req.user!.id, input);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  // === Attempts (Protected) ===
  app.get(api.attempts.list.path, requireAuth, async (req, res) => {
    const attempts = await storage.getAttempts(req.user!.id);
    res.json(attempts);
  });

  app.get(api.attempts.get.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const attempt = await storage.getAttempt(id, req.user!.id);
    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    res.json(attempt);
  });

  app.post(api.attempts.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.attempts.create.input.parse(req.body);
      const attempt = await storage.createAttempt({ ...input, userId: req.user!.id });
      if (!attempt) {
        return res.status(400).json({ message: "Validation error" });
      }
      res.status(201).json(attempt);
    } catch (err) {
      console.error("Create attempt error:", err);
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.put(api.attempts.update.path, requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const update = api.attempts.update.input.parse(req.body);
      const updated = await storage.updateAttempt(id, req.user!.id, update);
      if (!updated) {
        return res.status(404).json({ message: "Attempt not found" });
      }
      res.json(updated);
    } catch (err) {
      if (!(err instanceof z.ZodError)) {
        console.error("Update attempt error:", err);
      }
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.delete(api.attempts.delete.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const deleted = await storage.deleteAttempt(id, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: "Attempt not found" });
    }
    res.status(204).send();
  });

  // === Remote (Protected) ===
  app.get(api.remote.list.path, requireAuth, async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ message: "URL required" });

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch remote URL");
      
      const text = await response.text();
      const jsonFiles: string[] = [];
      const regex1 = /href="([^"]+\.json)"/g;
      const regex2 = /href='([^']+\.json)'/g;
      
      let match;
      while ((match = regex1.exec(text)) !== null) {
        jsonFiles.push(match[1]);
      }
      while ((match = regex2.exec(text)) !== null) {
        jsonFiles.push(match[1]);
      }
      
      const allFiles = Array.from(new Set(jsonFiles));
      
      res.json(allFiles);
    } catch (err) {
      console.error("Remote list error:", err);
      res.status(400).json({ message: "Failed to list remote files. Ensure the URL is accessible and is a directory listing." });
    }
  });

  app.get(api.remote.fetch.path, requireAuth, async (req, res) => {
    const url = req.query.url as string;
    const filename = req.query.filename as string;
    
    if (!url || !filename) return res.status(400).json({ message: "URL and filename required" });

    try {
      const fullUrl = url.endsWith('/') ? `${url}${filename}` : `${url}/${filename}`;
      const response = await fetch(fullUrl);
      if (!response.ok) throw new Error("Failed to download file");
      
      const json = await response.json();
      res.json(json);
    } catch (err) {
      console.error("Remote fetch error:", err);
      res.status(400).json({ message: "Failed to fetch remote file content" });
    }
  });

  return httpServer;
}
