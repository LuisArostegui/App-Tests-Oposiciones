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
} from "@shared/schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";

export interface IStorage {
  // Users
  createUser(user: InsertUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;

  // Test/Questions
  getTests(userId?: number): Promise<{ id: string; count: number; category: string | null }[]>;
  getQuestionsByTestId(testId: string, userId?: number): Promise<Question[]>;
  createQuestions(questionsList: InsertQuestion[]): Promise<void>;
  createQuestion(question: InsertQuestion): Promise<Question>;
  updateQuestion(id: number, userId: number, question: UpdateQuestion): Promise<Question | undefined>;
  deleteQuestion(id: number, userId: number): Promise<boolean>;
  deleteTest(testId: string, userId?: number): Promise<void>;
  renameTest(oldTestId: string, newTestId: string, userId?: number): Promise<void>;
  
  // Results
  getResults(userId?: number): Promise<Result[]>;
  createResult(result: InsertResult): Promise<Result>;
  deleteResult(id: number): Promise<void>;

  // Attempts
  getAttempts(userId?: number): Promise<TestAttempt[]>;
  getAttempt(id: number, userId: number): Promise<TestAttempt | undefined>;
  createAttempt(attempt: { testId: string; questionOrder: number[]; userId: number }): Promise<TestAttempt | undefined>;
  updateAttempt(id: number, userId: number, update: UpdateAttempt): Promise<TestAttempt | undefined>;
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
  async getTests(userId?: number): Promise<{ id: string; count: number; category: string | null }[]> {
    if (userId) {
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
    
    const rows = await db
      .select({
        id: questions.testId,
        count: sql<number>`count(*)`.mapWith(Number),
        category: sql<string>`MAX(${questions.category})`
      })
      .from(questions)
      .groupBy(questions.testId);
    return rows;
  }

  async getQuestionsByTestId(testId: string, userId?: number): Promise<Question[]> {
    if (userId) {
      return await db.select().from(questions).where(
        and(eq(questions.testId, testId), eq(questions.userId, userId))
      );
    }
    return await db.select().from(questions).where(eq(questions.testId, testId));
  }

  async createQuestions(questionsList: InsertQuestion[]): Promise<void> {
    if (questionsList.length === 0) return;
    await db.insert(questions).values(questionsList);
  }

  async createQuestion(question: InsertQuestion): Promise<Question> {
    const [created] = await db.insert(questions).values(question).returning();
    return created;
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
    const deleted = await db
      .delete(questions)
      .where(and(eq(questions.id, id), eq(questions.userId, userId)))
      .returning({ id: questions.id });
    return deleted.length > 0;
  }

  async deleteTest(testId: string, userId?: number): Promise<void> {
    if (userId) {
      await db.delete(questions).where(
        and(eq(questions.testId, testId), eq(questions.userId, userId))
      );
    } else {
      await db.delete(questions).where(eq(questions.testId, testId));
    }
  }

  async renameTest(oldTestId: string, newTestId: string, userId?: number): Promise<void> {
    if (userId) {
      await db.update(questions)
        .set({ testId: newTestId })
        .where(and(eq(questions.testId, oldTestId), eq(questions.userId, userId)));
    } else {
      await db.update(questions)
        .set({ testId: newTestId })
        .where(eq(questions.testId, oldTestId));
    }
  }

  // Results
  async getResults(userId?: number): Promise<Result[]> {
    if (userId) {
      return await db.select().from(results)
        .where(eq(results.userId, userId))
        .orderBy(desc(results.completedAt));
    }
    return await db.select().from(results).orderBy(desc(results.completedAt));
  }

  async createResult(result: InsertResult): Promise<Result> {
    const [saved] = await db.insert(results).values(result).returning();
    return saved;
  }

  async deleteResult(id: number): Promise<void> {
    await db.delete(results).where(eq(results.id, id));
  }

  // Attempts
  async getAttempts(userId?: number): Promise<TestAttempt[]> {
    if (userId) {
      return await db.select().from(testAttempts)
        .where(eq(testAttempts.userId, userId))
        .orderBy(desc(testAttempts.startedAt));
    }
    return await db.select().from(testAttempts).orderBy(desc(testAttempts.startedAt));
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
    const updateData: Partial<TestAttempt> = { ...update };
    if (update.status === "completed") {
      updateData.completedAt = new Date();
    }
    const [updated] = await db
      .update(testAttempts)
      .set(updateData)
      .where(and(eq(testAttempts.id, id), eq(testAttempts.userId, userId)))
      .returning();
    return updated;
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
