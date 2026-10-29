import { db } from "./db";
import {
  questions,
  results,
  testAttempts,
  users,
  type InsertQuestion,
  type Question,
  type UpdateQuestion,
  type InsertResult,
  type Result,
  type TestAttempt,
  type User,
  type InsertUser,
  type UpdateAttempt,
  type FinalizeAttemptInput,
} from "@shared/schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";

export type FinalizeAttemptOutcome =
  | { status: "completed"; result: Result }
  | { status: "not_found" | "conflict" | "missing_questions" | "invalid_answers" };

export type RenameTestOutcome = "renamed" | "not_found" | "name_conflict";
export type DeleteTestOutcome = "deleted" | "not_found" | "in_progress";
export type ImportQuestionsOutcome = "imported" | "not_found" | "name_conflict";

function serializeAnswers(answers: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(answers).sort(([first], [second]) => first.localeCompare(second))));
}

export interface IStorage {
  // Users
  createUser(user: InsertUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;

  // Test/Questions
  getTests(userId: number): Promise<{ id: string; count: number; category: string | null }[]>;
  getQuestionsByTestId(testId: string, userId: number): Promise<Question[]>;
  createQuestions(userId: number, questionsList: InsertQuestion[]): Promise<void>;
  importQuestions(userId: number, testId: string, questionsList: InsertQuestion[]): Promise<ImportQuestionsOutcome>;
  createQuestion(userId: number, question: InsertQuestion): Promise<Question>;
  updateQuestion(id: number, userId: number, question: UpdateQuestion): Promise<Question | undefined>;
  deleteQuestion(id: number, userId: number): Promise<boolean>;
  deleteTest(testId: string, userId: number): Promise<DeleteTestOutcome>;
  renameTest(oldTestId: string, newTestId: string, userId: number): Promise<RenameTestOutcome>;
  
  // Results
  getResults(userId: number): Promise<Result[]>;
  createResult(userId: number, result: InsertResult): Promise<Result>;

  // Attempts
  getAttempts(userId: number): Promise<TestAttempt[]>;
  getAttempt(id: number, userId: number): Promise<TestAttempt | undefined>;
  createAttempt(attempt: { testId: string; questionOrder: number[]; userId: number }): Promise<TestAttempt | undefined>;
  updateAttempt(id: number, userId: number, update: UpdateAttempt): Promise<TestAttempt | undefined>;
  finalizeAttempt(id: number, userId: number, input: FinalizeAttemptInput): Promise<FinalizeAttemptOutcome>;
  deleteAttempt(id: number, userId: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  // Tests/Questions
  async getTests(userId: number): Promise<{ id: string; count: number; category: string | null }[]> {
    const rows = await db
      .select({
        id: questions.testId,
        count: sql<number>`count(*)`.mapWith(Number),
        category: sql<string>`MAX(${questions.category})`
      })
      .from(questions)
      .where(eq(questions.userId, userId))
      .groupBy(questions.testId);
    return rows;
  }

  async getQuestionsByTestId(testId: string, userId: number): Promise<Question[]> {
    return await db.select().from(questions).where(
      and(eq(questions.testId, testId), eq(questions.userId, userId))
    );
  }

  async createQuestions(userId: number, questionsList: InsertQuestion[]): Promise<void> {
    if (questionsList.length === 0) return;
    await db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return;
      await tx.insert(questions).values(questionsList.map(question => ({ ...question, userId })));
    });
  }

  async importQuestions(userId: number, testId: string, questionsList: InsertQuestion[]): Promise<ImportQuestionsOutcome> {
    if (questionsList.length === 0) return "imported";
    return db.transaction(async (tx): Promise<ImportQuestionsOutcome> => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return "not_found";

      const [existingBank] = await tx.select({ id: questions.id }).from(questions).where(and(
        eq(questions.testId, testId), eq(questions.userId, userId),
      )).limit(1);
      if (existingBank) return "name_conflict";

      await tx.insert(questions).values(questionsList.map(question => ({ ...question, testId, userId })));
      return "imported";
    });
  }

  async createQuestion(userId: number, question: InsertQuestion): Promise<Question> {
    return db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) throw new Error("El propietario del test no existe");
      const [created] = await tx.insert(questions).values({ ...question, userId }).returning();
      return created;
    });
  }

  async updateQuestion(id: number, userId: number, update: UpdateQuestion): Promise<Question | undefined> {
    const [updated] = await db
      .update(questions)
      .set(update)
      .where(and(eq(questions.id, id), eq(questions.userId, userId)))
      .returning();
    return updated;
  }

  async deleteQuestion(id: number, userId: number): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return false;
      const deleted = await tx.delete(questions).where(and(
        eq(questions.id, id), eq(questions.userId, userId),
      )).returning({ id: questions.id });
      return deleted.length > 0;
    });
  }

  async deleteTest(testId: string, userId: number): Promise<DeleteTestOutcome> {
    return db.transaction(async (tx): Promise<DeleteTestOutcome> => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return "not_found";

      const [existingTest] = await tx.select({ id: questions.id }).from(questions).where(and(
        eq(questions.testId, testId), eq(questions.userId, userId),
      )).limit(1);
      if (!existingTest) return "not_found";

      const [activeAttempt] = await tx.select({ id: testAttempts.id }).from(testAttempts).where(and(
        eq(testAttempts.testId, testId),
        eq(testAttempts.userId, userId),
        eq(testAttempts.status, "in_progress"),
      )).limit(1);
      if (activeAttempt) return "in_progress";

      await tx.delete(questions).where(and(
        eq(questions.testId, testId), eq(questions.userId, userId),
      ));
      return "deleted";
    });
  }

  async renameTest(oldTestId: string, newTestId: string, userId: number): Promise<RenameTestOutcome> {
    return db.transaction(async (tx): Promise<RenameTestOutcome> => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return "not_found";

      const [existingTest] = await tx.select({ id: questions.id }).from(questions).where(and(
        eq(questions.testId, oldTestId), eq(questions.userId, userId),
      )).limit(1);
      if (!existingTest) return "not_found";

      if (oldTestId !== newTestId) {
        const [nameCollision] = await tx.select({ id: questions.id }).from(questions).where(and(
          eq(questions.testId, newTestId), eq(questions.userId, userId),
        )).limit(1);
        if (nameCollision) return "name_conflict";
      }

      await tx.update(questions).set({ testId: newTestId }).where(and(
        eq(questions.testId, oldTestId), eq(questions.userId, userId),
      ));
      await tx.update(testAttempts).set({ testId: newTestId }).where(and(
        eq(testAttempts.testId, oldTestId), eq(testAttempts.userId, userId),
      ));
      await tx.update(results).set({ testId: newTestId }).where(and(
        eq(results.testId, oldTestId), eq(results.userId, userId),
      ));
      return "renamed";
    });
  }

  // Results
  async getResults(userId: number): Promise<Result[]> {
    return await db.select().from(results)
      .where(eq(results.userId, userId))
      .orderBy(desc(results.completedAt), desc(results.id));
  }

  async createResult(userId: number, result: InsertResult): Promise<Result> {
    const [saved] = await db.insert(results).values({ ...result, userId }).returning();
    return saved;
  }

  // Attempts
  async getAttempts(userId: number): Promise<TestAttempt[]> {
    return await db.select().from(testAttempts)
      .where(eq(testAttempts.userId, userId))
      .orderBy(desc(testAttempts.startedAt));
  }

  async getAttempt(id: number, userId: number): Promise<TestAttempt | undefined> {
    const [attempt] = await db
      .select()
      .from(testAttempts)
      .where(
        and(
          eq(testAttempts.id, id),
          eq(testAttempts.userId, userId),
        ),
      );
    return attempt;
  }

  async createAttempt(attempt: { testId: string; questionOrder: number[]; userId: number }): Promise<TestAttempt | undefined> {
    const { questionOrder, testId, userId } = attempt;
    if (questionOrder.length === 0 || questionOrder.some(id => !Number.isInteger(id) || id <= 0) || new Set(questionOrder).size !== questionOrder.length) {
      return undefined;
    }

    return db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return undefined;

      const verified = await tx.select({ id: questions.id }).from(questions).where(and(
        eq(questions.testId, testId),
        eq(questions.userId, userId),
        inArray(questions.id, questionOrder),
      )).for("share");
      if (verified.length !== questionOrder.length) return undefined;

      const [created] = await tx.insert(testAttempts).values({
        testId,
        questionOrder,
        totalQuestions: verified.length,
        status: "in_progress",
        currentIndex: 0,
        answers: {},
        userId,
      }).returning();
      return created;
    });
  }

  async updateAttempt(id: number, userId: number, update: UpdateAttempt): Promise<TestAttempt | undefined> {
    const { expectedVersion, ...changes } = update;
    const [updated] = await db
      .update(testAttempts)
      .set({ ...changes, writeVersion: sql`${testAttempts.writeVersion} + 1` })
      .where(and(
        eq(testAttempts.id, id),
        eq(testAttempts.userId, userId),
        eq(testAttempts.status, "in_progress"),
        eq(testAttempts.writeVersion, expectedVersion),
      ))
      .returning();
    return updated;
  }

  async finalizeAttempt(id: number, userId: number, input: FinalizeAttemptInput): Promise<FinalizeAttemptOutcome> {
    return db.transaction(async (tx): Promise<FinalizeAttemptOutcome> => {
      // Lifecycle transactions take the owner row first. This serializes finalization
      // with rename/delete/import before either operation locks attempts or questions.
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (!owner) return { status: "not_found" };

      const [attempt] = await tx.select().from(testAttempts).where(and(
        eq(testAttempts.id, id),
        eq(testAttempts.userId, userId),
      )).for("update");
      if (!attempt) return { status: "not_found" };

      if (attempt.status === "completed") {
        if (serializeAnswers(attempt.answers as Record<string, string>) !== serializeAnswers(input.answers)) {
          return { status: "conflict" };
        }
        const [existingResult] = await tx.select().from(results).where(and(
          eq(results.attemptId, attempt.id),
          eq(results.userId, userId),
        ));
        return existingResult ? { status: "completed", result: existingResult } : { status: "conflict" };
      }
      if (attempt.status !== "in_progress") return { status: "conflict" };

      const questionOrder = attempt.questionOrder as number[];
      if (questionOrder.length === 0 || new Set(questionOrder).size !== questionOrder.length) {
        return { status: "missing_questions" };
      }

      const attemptQuestions = await tx.select().from(questions).where(and(
        eq(questions.testId, attempt.testId),
        eq(questions.userId, userId),
        inArray(questions.id, questionOrder),
      )).for("share");
      if (attemptQuestions.length !== questionOrder.length) return { status: "missing_questions" };

      const questionById = new Map(attemptQuestions.map((question) => [String(question.id), question]));
      for (const [questionId, answer] of Object.entries(input.answers)) {
        const question = questionById.get(questionId);
        const options = question?.answers as Record<string, unknown> | undefined;
        if (!question || !options || !Object.hasOwn(options, answer)) return { status: "invalid_answers" };
      }
      if (attemptQuestions.some((question) => {
        const options = question.answers as Record<string, unknown> | null;
        return !options || !Object.hasOwn(options, question.correctAnswer);
      })) return { status: "missing_questions" };

      const correctCount = attemptQuestions.reduce((count, question) => (
        input.answers[String(question.id)] === question.correctAnswer ? count + 1 : count
      ), 0);
      // Scoring remains the existing rule: correct answers / attempt question count, rounded to the nearest integer percent.
      const score = Math.round((correctCount / questionOrder.length) * 100);
      const completedAt = new Date();
      await tx.update(testAttempts).set({
        answers: input.answers,
        currentIndex: questionOrder.length - 1,
        status: "completed",
        correctCount,
        score,
        completedAt,
      }).where(and(
        eq(testAttempts.id, attempt.id),
        eq(testAttempts.userId, userId),
        eq(testAttempts.status, "in_progress"),
      ));

      const [result] = await tx.insert(results).values({
        testId: attempt.testId,
        score,
        correctCount,
        totalQuestions: questionOrder.length,
        completedAt,
        userId,
        attemptId: attempt.id,
      }).returning();
      return { status: "completed", result };
    });
  }

  async deleteAttempt(id: number, userId: number): Promise<boolean> {
    const deleted = await db
      .delete(testAttempts)
      .where(and(eq(testAttempts.id, id), eq(testAttempts.userId, userId)))
      .returning({ id: testAttempts.id });
    return deleted.length > 0;
  }
}

export const storage = new DatabaseStorage();
