// api/index.js — Vercel serverless function entry point
// Imports the Express app from src/index.js WITHOUT starting the server

import { app } from "../src/index.js";

export default app;
