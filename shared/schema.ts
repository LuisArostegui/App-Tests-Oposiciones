import { pgTable, text, serial, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

// Users table for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Stores questions imported from JSONs
export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull(),
  questionText: text("question_text").notNull(),
  answers: jsonb("answers").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  category: text("category"),
  userId: integer("user_id"),
});

// Stores test attempts (in-progress or completed)
export const testAttempts = pgTable("test_attempts", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull(),
  status: text("status").notNull().default("in_progress"),
  currentIndex: integer("current_index").notNull().default(0),
  answers: jsonb("answers").notNull().default({}),
  questionOrder: jsonb("question_order").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  correctCount: integer("correct_count").default(0),
  score: integer("score").default(0),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  userId: integer("user_id"),
});

// Stores historical results (completed tests). Legacy results have no attempt link.
export const results = pgTable("results", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull(),
  score: integer("score").notNull(),
  correctCount: integer("correct_count").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
  userId: integer("user_id"),
  attemptId: integer("attempt_id").unique().references(() => testAttempts.id, { onDelete: "set null" }),
});

// Session table for connect-pg-simple
export const sessions = pgTable("session", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

// === SCHEMAS ===

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertQuestionSchema = createInsertSchema(questions).omit({ id: true, userId: true }).strict();
export const insertResultSchema = createInsertSchema(results).omit({ id: true, completedAt: true, userId: true }).strict();
export const insertAttemptSchema = createInsertSchema(testAttempts).omit({ id: true, startedAt: true, completedAt: true });

export const updateQuestionSchema = z.object({
  questionText: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
  correctAnswer: z.string().optional(),
  category: z.string().nullable().optional(),
}).strict();

export const updateAttemptSchema = z.object({
  currentIndex: z.number().int().nonnegative().optional(),
  answers: z.record(z.string(), z.string()).optional(),
}).strict();

export const finalizeAttemptSchema = z.object({
  answers: z.record(z.string(), z.string()),
}).strict();

// Login schema (same as insert but for clarity)
export const loginSchema = z.object({
  username: z.string().min(3, "El usuario debe tener al menos 3 caracteres"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export const registerSchema = z.object({
  username: z.string().min(3, "El usuario debe tener al menos 3 caracteres"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

// === TYPES ===

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Question = typeof questions.$inferSelect;
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type UpdateQuestion = z.infer<typeof updateQuestionSchema>;
export type Result = typeof results.$inferSelect;
export type InsertResult = z.infer<typeof insertResultSchema>;
export type TestAttempt = typeof testAttempts.$inferSelect;
export type InsertAttempt = z.infer<typeof insertAttemptSchema>;
export type UpdateAttempt = z.infer<typeof updateAttemptSchema>;
export type FinalizeAttemptInput = z.infer<typeof finalizeAttemptSchema>;

// Helper for the frontend to know what answers look like
export type AnswerMap = Record<string, string>;
