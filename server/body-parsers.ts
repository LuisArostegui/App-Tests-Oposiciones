import express from "express";

// 5 MiB for the local file plus bounded space for the JSON request wrapper.
export const importJsonBodyParser = express.json({ limit: 5 * 1024 * 1024 + 16 * 1024 });
