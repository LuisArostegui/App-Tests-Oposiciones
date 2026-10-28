import express from "express";
import { QUESTION_IMPORT_MAX_REQUEST_BYTES } from "@shared/routes";

// This parser is mounted only on the authenticated import route, after the CSRF guard.
export const importJsonBodyParser = express.json({ limit: QUESTION_IMPORT_MAX_REQUEST_BYTES });
