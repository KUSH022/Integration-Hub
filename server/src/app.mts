import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import hubHandler from '../api/index.js';

// Vercel recognizes src/app.* as the Express service entrypoint. Keep this file
// as .mts so its ES module syntax remains explicit in Vercel's bundled runtime.
const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  void hubHandler(req, res).catch(next);
});

export default app;
