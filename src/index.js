// src/index.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
  ensureStripeProducts,
  getOrCreateCustomer,
  createCheckoutSession,
  createPortalSession,
  planFromPriceId,
  verifyWebhook,
  stripe,
} from "./stripe.js";

import { sendVerificationEmail, sendPasswordResetEmail } from "./email.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// --- ENV CHECKS (keep these strict; helps you catch deploy mistakes) ---
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing in .env");
}

// If you want to enforce DB at boot, uncomment this:
// if (!process.env.DATABASE_URL) {
//   throw new Error("DATABASE_URL is missing in .env");
// }

const prisma = new PrismaClient();

// --- AUTO-MIGRATION (adds new columns on startup for TimescaleDB) ---
async function autoMigrate() {
  try {
    await prisma.$queryRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" TEXT DEFAULT 'free'`);
  } catch (e) { /* column may already exist */ }
  try {
    await prisma.$queryRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT`);
  } catch (e) { /* column may already exist */ }
  console.log("[AutoMigrate] Schema up to date");
}

// -------------------- HELPERS / MIDDLEWARE --------------------

function validate(schema) {
  return (req, res, next) => {
    try {
      req.validated = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      next();
    } catch (err) {
      return res.status(400).json({
        error: "validation_error",
        details: err?.issues ?? err?.errors ?? err,
      });
    }
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, email, iat, exp }
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }
}

// Alias for task spec compatibility
const authenticateToken = requireAuth;

async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { role: true },
    });
    if (!user || user.role !== "ADMIN") {
      return res.status(403).json({ error: "forbidden: admin access required" });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

async function requireEmailVerified(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { emailVerified: true },
    });
    if (!user || !user.emailVerified) {
      return res.status(403).json({ error: "email_not_verified", message: "Please verify your email address to access this feature." });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

function requireOrgRole(minRole) {
  // minRole: "MEMBER", "ADMIN", or "OWNER"
  return async (req, res, next) => {
    try {
      const orgId = req.params.orgId;
      if (!orgId) return res.status(400).json({ error: "orgId is required" });

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { ownerId: true },
      });

      if (!org) return res.status(404).json({ error: "organization not found" });

      if (org.ownerId === req.user.userId) {
        req.orgRole = "OWNER";
        return next();
      }

      const member = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: req.user.userId } },
        select: { role: true },
      });

      if (!member) return res.status(404).json({ error: "organization not found" });

      const roleHierarchy = { MEMBER: 1, ADMIN: 2, OWNER: 3 };
      const requiredLevel = roleHierarchy[minRole] || 1;
      const userLevel = roleHierarchy[member.role] || 1;

      if (userLevel < requiredLevel) {
        return res.status(403).json({ error: "forbidden" });
      }

      req.orgRole = member.role;
      next();
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };
}

async function logActivity({ ticketId, actorId, type, message }) {
  return prisma.ticketActivity.create({
    data: { ticketId, actorId, type, message },
  });
}

// --- Notification helper ---
async function createNotification({ userId, type, title, body, ticketId, projectId }) {
  // Don't notify self
  return prisma.notification.create({
    data: { userId, type, title, body, ticketId, projectId },
  });
}

// Scan content for @mentions and return array of mentioned usernames
async function resolveMentions(content, projectId) {
  const mentions = [...content.matchAll(/@(\w+)/g)].map((m) => m[1]);
  if (mentions.length === 0) return [];
  // Look up users by name within the project's members
  const users = await prisma.user.findMany({
    where: {
      name: { in: mentions },
      OR: [
        { ownedProjects: { some: { id: projectId } } },
        { memberships: { some: { projectId } } },
      ],
    },
    select: { id: true, name: true },
  });
  return users;
}

async function getProjectRole(projectId, userId) {
  // owner is always OWNER
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (!project) return null;
  if (project.ownerId === userId) return "OWNER";

  // otherwise check membership table
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });

  return member?.role ?? null; // "MEMBER" or null
}

function requireProjectRole(minRole) {
  // minRole: "MEMBER" or "OWNER"
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      if (!projectId) return res.status(400).json({ error: "projectId is required" });

      const role = await getProjectRole(projectId, req.user.userId);

      // If role is null, it means project doesn't exist OR user isn't a member
      // Using 404 helps avoid leaking project existence.
      if (!role) return res.status(404).json({ error: "project not found" });

      if (minRole === "OWNER" && role !== "OWNER") {
        return res.status(403).json({ error: "forbidden" });
      }

      req.projectRole = role;
      next();
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };
}

function requireTicketRole(minRole = "MEMBER") {
  // minRole: "MEMBER" or "OWNER"
  return async (req, res, next) => {
    try {
      const ticketId = req.params.ticketId;
      if (!ticketId) return res.status(400).json({ error: "ticketId is required" });

      // Load ticket -> projectId
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, projectId: true },
      });

      if (!ticket) return res.status(404).json({ error: "ticket not found" });

      const role = await getProjectRole(ticket.projectId, req.user.userId);
      if (!role) return res.status(404).json({ error: "project not found" });

      if (minRole === "OWNER" && role !== "OWNER") {
        return res.status(403).json({ error: "forbidden" });
      }

      req.ticket = ticket;
      req.projectRole = role;

      next();
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };
}

// --- Plan-based limits ---

const PLAN_LIMITS = {
  free: { maxProjects: 3, maxUsers: 5 },
  pro: { maxProjects: Infinity, maxUsers: Infinity },
  enterprise: { maxProjects: Infinity, maxUsers: Infinity },
};

function checkPlanLimit(limitType) {
  return async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { plan: true },
      });
      const plan = user?.plan || "free";
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

      if (limitType === "projects") {
        const count = await prisma.project.count({
          where: { ownerId: req.user.userId },
        });
        if (count >= limits.maxProjects) {
          return res.status(403).json({
            error: "plan_limit_reached",
            message: `Your ${plan} plan allows up to ${limits.maxProjects} project(s). Please upgrade to create more.`,
            plan,
            limit: limits.maxProjects,
            current: count,
          });
        }
      }

      if (limitType === "members") {
        const { projectId } = req.params;
        const count = await prisma.projectMember.count({
          where: { projectId },
        });
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { ownerId: true },
        });
        // Include owner in count
        const totalUsers = count + (project ? 1 : 0);
        if (totalUsers >= limits.maxUsers) {
          return res.status(403).json({
            error: "plan_limit_reached",
            message: `Your ${plan} plan allows up to ${limits.maxUsers} user(s) per project. Please upgrade to add more.`,
            plan,
            limit: limits.maxUsers,
            current: totalUsers,
          });
        }
      }

      next();
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };
}

// -------------------- APP SETUP --------------------

const app = express();
app.set("trust proxy", 1);
const apiRouter = express.Router();

app.use(helmet());
app.use(express.json());

// Rate limit (nice protection for auth endpoints when public on the internet)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 120 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// CORS for Vercel + local dev
// Set CORS_ORIGIN in Railway to: https://your-frontend.vercel.app
// For local dev you can do: http://localhost:5173 or http://localhost:3001 etc.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser tools (curl/postman) with no origin
      if (!origin) return cb(null, true);
      // if no CORS_ORIGIN set, allow all (dev-friendly)
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// -------------------- BASIC ROUTES --------------------

apiRouter.get("/", (req, res) => {
  res.send("TrackQA API is running ✅");
});

apiRouter.get("/health/db", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// -------------------- ZOD SCHEMAS --------------------

const TicketStatus = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
const TicketPriority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const TicketType = z.enum(["BUG", "FEATURE_REQUEST", "IMPROVEMENT", "TECHNICAL_DEBT", "DOCUMENTATION", "TASK"]);

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1).optional(),
  }),
  params: z.any(),
  query: z.any(),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  params: z.any(),
  query: z.any(),
});

const createProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    organizationId: z.string().optional(),
  }),
  params: z.any(),
  query: z.any(),
});

const getProjectSchema = z.object({
  body: z.any(),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const updateProjectSchema = z.object({
  body: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "at least one field is required",
    }),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const createTicketSchema = z.object({
  body: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: TicketPriority.optional(),
    type: TicketType.optional(),
  }),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const getTicketSchema = z.object({
  body: z.any(),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.any(),
});

const updateTicketSchema = z.object({
  body: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      status: TicketStatus.optional(),
      priority: TicketPriority.optional(),
      type: TicketType.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "at least one field is required",
    }),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.any(),
});

const listTicketsSchema = z.object({
  body: z.any(),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.object({
    status: TicketStatus.optional(),
    priority: TicketPriority.optional(),
    type: TicketType.optional(),
    q: z.string().optional(),
    sort: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

const createCommentSchema = z.object({
  body: z.object({
    content: z.string().min(1),
  }),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.any(),
});

const listCommentsSchema = z.object({
  body: z.any(),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.any(),
});

const deleteCommentSchema = z.object({
  body: z.any(),
  params: z.object({
    commentId: z.string().min(1),
  }),
  query: z.any(),
});

const listActivitySchema = z.object({
  body: z.any(),
  params: z.object({ ticketId: z.string().min(1) }),
  query: z.any(),
});

const assignTicketSchema = z.object({
  body: z.object({
    assigneeId: z.string().min(1).nullable(),
  }),
  params: z.object({
    ticketId: z.string().min(1),
  }),
  query: z.any(),
});

const addMemberSchema = z.object({
  body: z.object({
    userId: z.string().min(1),
    role: z.enum(["OWNER", "MEMBER"]).optional(),
  }),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const listMembersSchema = z.object({
  body: z.any(),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const removeMemberSchema = z.object({
  body: z.any(),
  params: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
  }),
  query: z.any(),
});

const listUsersSchema = z.object({
  body: z.any(),
  params: z.any(),
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

const getUserSchema = z.object({
  body: z.any(),
  params: z.object({
    userId: z.string().min(1),
  }),
  query: z.any(),
});

const updateUserSchema = z.object({
  body: z
    .object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      role: z.enum(["USER", "ADMIN"]).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "at least one field is required",
    }),
  params: z.object({
    userId: z.string().min(1),
  }),
  query: z.any(),
});

const dashboardStatsSchema = z.object({
  body: z.any(),
  params: z.any(),
  query: z.object({
    projectId: z.string().optional(),
  }),
});

const createOrgSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  params: z.any(),
  query: z.any(),
});

const getOrgSchema = z.object({
  body: z.any(),
  params: z.object({
    orgId: z.string().min(1),
  }),
  query: z.any(),
});

const updateOrgSchema = z.object({
  body: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "at least one field is required",
    }),
  params: z.object({
    orgId: z.string().min(1),
  }),
  query: z.any(),
});

const listOrgMembersSchema = z.object({
  body: z.any(),
  params: z.object({
    orgId: z.string().min(1),
  }),
  query: z.any(),
});

// -------------------- ROUTES --------------------

// Activity
apiRouter.get(
  "/tickets/:ticketId/activity",
  requireAuth,
  validate(listActivitySchema),
  requireTicketRole("MEMBER"),
  async (req, res, next) => {
    try {
      const { ticketId } = req.validated.params;
      const activity = await prisma.ticketActivity.findMany({
        where: { ticketId },
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, email: true, name: true } } },
      });
      res.json(activity);
    } catch (err) {
      next(err);
    }
  }
);

// Register
apiRouter.post("/auth/register", validate(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.validated.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "email already registered" });

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, password: hashed, name },
      select: { id: true, email: true, name: true, createdAt: true, emailVerified: true },
    });

    // Auto-create verification token
    const verifyToken = generateToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: verifyToken,
        type: "EMAIL_VERIFY",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Fire-and-forget: send verification email (failures are logged, never break the API)
    sendVerificationEmail(email, verifyToken).catch(() => {});

    res.status(201).json({ ...user, message: "Verification email sent. Check your inbox." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Login
apiRouter.post("/auth/login", validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.validated.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "invalid credentials" });

    const token = jwt.sign(
      { userId: user.id, email: user.email, emailVerified: user.emailVerified },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Me
apiRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, email: true, name: true, role: true, plan: true, stripeCustomerId: true, emailVerified: true, createdAt: true },
  });

  res.json(user);
});

// ==================== EMAIL VERIFICATION & PASSWORD RESET ====================

// Verify email
apiRouter.post("/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token is required" });

    const vt = await prisma.verificationToken.findUnique({ where: { token } });
    if (!vt) return res.status(400).json({ error: "invalid token" });
    if (vt.type !== "EMAIL_VERIFY") return res.status(400).json({ error: "invalid token type" });
    if (vt.expiresAt < new Date()) return res.status(400).json({ error: "token expired" });

    await prisma.user.update({
      where: { id: vt.userId },
      data: { emailVerified: true },
    });

    // Delete the used token
    await prisma.verificationToken.delete({ where: { id: vt.id } });

    res.json({ message: "email verified successfully" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Resend verification token (requires auth)
apiRouter.post("/auth/resend-verification", requireAuth, async (req, res) => {
  try {
    // Delete old EMAIL_VERIFY tokens for this user
    await prisma.verificationToken.deleteMany({
      where: { userId: req.user.userId, type: "EMAIL_VERIFY" },
    });

    const token = generateToken();
    await prisma.verificationToken.create({
      data: {
        userId: req.user.userId,
        token,
        type: "EMAIL_VERIFY",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Fire-and-forget: send verification email (failures are logged, never break the API)
    sendVerificationEmail(req.user.email, token).catch(() => {});

    res.json({ message: "Verification email sent. Check your inbox." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Forgot password
apiRouter.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      // Always return success to prevent email enumeration
      return res.json({ message: "if an account exists with that email, a reset token has been generated" });
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (!user) {
      return res.json({ message: "if an account exists with that email, a reset token has been generated" });
    }

    // Delete old PASSWORD_RESET tokens for this user
    await prisma.verificationToken.deleteMany({
      where: { userId: user.id, type: "PASSWORD_RESET" },
    });

    const token = generateToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        token,
        type: "PASSWORD_RESET",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Fire-and-forget: send password reset email
    sendPasswordResetEmail(email, token).catch(() => {});

    res.json({ message: "if an account exists with that email, a reset link has been sent" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Reset password
apiRouter.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword are required" });
    if (newPassword.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

    const vt = await prisma.verificationToken.findUnique({ where: { token } });
    if (!vt) return res.status(400).json({ error: "invalid token" });
    if (vt.type !== "PASSWORD_RESET") return res.status(400).json({ error: "invalid token type" });
    if (vt.expiresAt < new Date()) return res.status(400).json({ error: "token expired" });

    const hashed = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: vt.userId },
      data: { password: hashed, passwordChangedAt: new Date() },
    });

    // Delete the used token
    await prisma.verificationToken.delete({ where: { id: vt.id } });

    res.json({ message: "password reset successfully" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== PROJECT CRUD ====================

// Create project
apiRouter.post("/projects", requireAuth, requireEmailVerified, checkPlanLimit("projects"), validate(createProjectSchema), async (req, res) => {
  try {
    const { name, description, organizationId } = req.validated.body;

    // If organizationId is provided, verify user is a member
    if (organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { ownerId: true },
      });
      if (!org) return res.status(400).json({ error: "organization not found" });

      if (org.ownerId !== req.user.userId) {
        const member = await prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId: req.user.userId } },
        });
        if (!member) {
          return res.status(403).json({ error: "you must be a member of the organization" });
        }
      }
    }

    const project = await prisma.project.create({
      data: { name, description, organizationId, ownerId: req.user.userId },
    });

    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List my projects
apiRouter.get("/projects", requireAuth, async (req, res) => {
  const projects = await prisma.project.findMany({
    where: {
      OR: [{ ownerId: req.user.userId }, { members: { some: { userId: req.user.userId } } }],
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(projects);
});

// Get one project (details)
apiRouter.get(
  "/projects/:projectId",
  requireAuth,
  validate(getProjectSchema),
  requireProjectRole("MEMBER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          owner: { select: { id: true, email: true, name: true } },
          members: { include: { user: { select: { id: true, email: true, name: true } } } },
          _count: { select: { tickets: true, members: true } },
        },
      });

      if (!project) return res.status(404).json({ error: "project not found" });

      res.json(project);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Update project
apiRouter.put(
  "/projects/:projectId",
  requireAuth,
  validate(updateProjectSchema),
  requireProjectRole("OWNER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;
      const { name, description } = req.validated.body;

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: { name, description },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Delete project (hard delete — only owner)
apiRouter.delete(
  "/projects/:projectId",
  requireAuth,
  validate(getProjectSchema),
  requireProjectRole("OWNER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;

      await prisma.project.delete({ where: { id: projectId } });

      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// ==================== TICKET CRUD ====================

// Create ticket
apiRouter.post(
  "/projects/:projectId/tickets",
  requireAuth,
  requireEmailVerified,
  validate(createTicketSchema),
  requireProjectRole("MEMBER"),
  async (req, res, next) => {
    try {
      const { projectId } = req.validated.params;
      const { title, description, priority, type } = req.validated.body;

      const ticket = await prisma.ticket.create({
        data: {
          title,
          description,
          priority,
          type,
          projectId,
          reporterId: req.user.userId,
        },
      });

      await logActivity({
        ticketId: ticket.id,
        actorId: req.user.userId,
        type: "TICKET_CREATED",
        message: `Ticket created: ${ticket.title}`,
      });

      res.status(201).json(ticket);
    } catch (err) {
      next(err);
    }
  }
);

// List tickets
apiRouter.get(
  "/projects/:projectId/tickets",
  requireAuth,
  validate(listTicketsSchema),
  requireProjectRole("MEMBER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;
      const { status, priority, type, q, sort = "createdAt:desc", page = 1, pageSize = 20 } =
        req.validated.query;

      const skip = (page - 1) * pageSize;

      const [sortField, sortDirRaw] = String(sort).split(":");
      const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

      const allowedSortFields = new Set(["createdAt", "updatedAt", "priority", "status", "title"]);
      const orderByField = allowedSortFields.has(sortField) ? sortField : "createdAt";

      const where = {
        projectId,
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(type ? { type } : {}),
        ...(q
          ? {
              OR: [{ title: { contains: q } }, { description: { contains: q } }],
            }
          : {}),
      };

      const [total, tickets] = await Promise.all([
        prisma.ticket.count({ where }),
        prisma.ticket.findMany({
          where,
          orderBy: { [orderByField]: sortDir },
          skip,
          take: pageSize,
        }),
      ]);

      res.json({
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        tickets,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Get one ticket (details)
apiRouter.get(
  "/tickets/:ticketId",
  requireAuth,
  validate(getTicketSchema),
  requireTicketRole("MEMBER"),
  async (req, res) => {
    try {
      const { ticketId } = req.validated.params;

      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          project: { select: { id: true, name: true } },
          reporter: { select: { id: true, email: true, name: true } },
          assignee: { select: { id: true, email: true, name: true } },
          _count: { select: { comments: true, activities: true } },
        },
      });

      if (!ticket) return res.status(404).json({ error: "ticket not found" });
      res.json(ticket);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Update ticket
apiRouter.patch(
  "/tickets/:ticketId",
  requireAuth,
  validate(updateTicketSchema),
  requireTicketRole("MEMBER"),
  async (req, res) => {
    const { ticketId } = req.validated.params;
    const { title, description, status, priority, type } = req.validated.body;

    const before = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true, description: true, status: true, priority: true, type: true },
    });

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { title, description, status, priority, type },
    });

    const changes = [];
    if (title && title !== before.title) changes.push("title");
    if (description !== undefined && description !== before.description) changes.push("description");
    if (status && status !== before.status) changes.push(`status ${before.status} → ${status}`);
    if (priority && priority !== before.priority)
      changes.push(`priority ${before.priority} → ${priority}`);
    if (type && type !== before.type) changes.push(`type ${before.type} → ${type}`);

    if (changes.length) {
      await logActivity({
        ticketId,
        actorId: req.user.userId,
        type: "TICKET_UPDATED",
        message: `Updated: ${changes.join(", ")}`,
      });
    }

    // Create STATUS_CHANGE notification if status changed
    if (status && status !== before.status) {
      const recipients = new Set();
      if (updated.assigneeId && updated.assigneeId !== req.user.userId) recipients.add(updated.assigneeId);
      if (updated.reporterId && updated.reporterId !== req.user.userId) recipients.add(updated.reporterId);

      for (const uid of recipients) {
        await createNotification({
          userId: uid,
          type: "STATUS_CHANGE",
          title: "Ticket status updated",
          body: `"${updated.title}" moved from ${before.status} to ${status}`,
          ticketId,
          projectId: updated.projectId,
        });
      }
    }

    res.json(updated);
  }
);

// Delete ticket
apiRouter.delete("/tickets/:ticketId", requireAuth, requireTicketRole("OWNER"), async (req, res) => {
  const { ticketId } = req.params;
  await prisma.ticket.delete({ where: { id: ticketId } });
  res.json({ deleted: true });
});

// Create comment
apiRouter.post(
  "/tickets/:ticketId/comments",
  requireAuth,
  validate(createCommentSchema),
  requireTicketRole("MEMBER"),
  async (req, res, next) => {
    try {
      const { ticketId } = req.validated.params;
      const { content } = req.validated.body;

      const comment = await prisma.comment.create({
        data: {
          content,
          ticketId,
          authorId: req.user.userId,
        },
      });

      await logActivity({
        ticketId,
        actorId: req.user.userId,
        type: "COMMENT_ADDED",
        message: "Comment added",
      });

      // Notify ticket assignee and reporter about new comment (but not the author)
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { title: true, assigneeId: true, reporterId: true, projectId: true },
      });

      const commentRecipients = new Set();
      if (ticket.assigneeId && ticket.assigneeId !== req.user.userId) commentRecipients.add(ticket.assigneeId);
      if (ticket.reporterId && ticket.reporterId !== req.user.userId) commentRecipients.add(ticket.reporterId);

      for (const uid of commentRecipients) {
        await createNotification({
          userId: uid,
          type: "COMMENT",
          title: "New comment",
          body: `New comment on "${ticket.title}"`,
          ticketId,
          projectId: ticket.projectId,
        });
      }

      // Resolve @mentions and create MENTION notifications
      const mentionedUsers = await resolveMentions(content, ticket.projectId);
      for (const user of mentionedUsers) {
        if (user.id !== req.user.userId && !commentRecipients.has(user.id)) {
          await createNotification({
            userId: user.id,
            type: "MENTION",
            title: "You were mentioned",
            body: `You were mentioned in a comment on "${ticket.title}"`,
            ticketId,
            projectId: ticket.projectId,
          });
        }
      }

      res.status(201).json(comment);
    } catch (err) {
      next(err);
    }
  }
);

// List comments
apiRouter.get(
  "/tickets/:ticketId/comments",
  requireAuth,
  validate(listCommentsSchema),
  requireTicketRole("MEMBER"),
  async (req, res) => {
    try {
      const { ticketId } = req.validated.params;

      const comments = await prisma.comment.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, email: true, name: true } },
        },
      });

      res.json(comments);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Assign/unassign
apiRouter.patch(
  "/tickets/:ticketId/assign",
  requireAuth,
  validate(assignTicketSchema),
  requireTicketRole("OWNER"),
  async (req, res) => {
    try {
      const { ticketId } = req.validated.params;
      const { assigneeId } = req.validated.body;

      const projectId = req.ticket.projectId;

      if (assigneeId) {
        const allowedAssignee = await prisma.project.findFirst({
          where: {
            id: projectId,
            OR: [{ ownerId: assigneeId }, { members: { some: { userId: assigneeId } } }],
          },
          select: { id: true },
        });

        if (!allowedAssignee) {
          return res.status(400).json({ error: "assignee must be a member of the project" });
        }
      }

      const updated = await prisma.ticket.update({
        where: { id: ticketId },
        data: { assigneeId },
        include: { assignee: { select: { id: true, email: true, name: true } } },
      });

      const message = assigneeId
        ? `Assigned to ${updated.assignee?.email ?? "user"}`
        : "Unassigned ticket";

      await logActivity({
        ticketId,
        actorId: req.user.userId,
        type: "TICKET_UPDATED",
        message,
      });

      // Create ASSIGNED notification for the new assignee
      if (assigneeId && assigneeId !== req.user.userId) {
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { title: true, projectId: true },
        });
        await createNotification({
          userId: assigneeId,
          type: "ASSIGNED",
          title: "Ticket assigned to you",
          body: `You were assigned to "${ticket.title}"`,
          ticketId,
          projectId: ticket.projectId,
        });
      }

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Add member (owner)
apiRouter.post(
  "/projects/:projectId/members",
  requireAuth,
  validate(addMemberSchema),
  requireProjectRole("OWNER"),
  checkPlanLimit("members"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;
      const { userId, role: newRole = "MEMBER" } = req.validated.body;

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return res.status(404).json({ error: "user not found" });

      const member = await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: { role: newRole },
        create: { projectId, userId, role: newRole },
      });

      res.status(201).json(member);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// List members (owner or member)
apiRouter.get("/projects/:projectId/members", requireAuth, validate(listMembersSchema), async (req, res) => {
  try {
    const { projectId } = req.validated.params;

    const role = await getProjectRole(projectId, req.user.userId);
    if (!role) return res.status(404).json({ error: "project not found" });

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    res.json(members);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Remove member (owner)
apiRouter.delete(
  "/projects/:projectId/members/:userId",
  requireAuth,
  validate(removeMemberSchema),
  requireProjectRole("OWNER"),
  async (req, res) => {
    try {
      const { projectId, userId } = req.validated.params;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true },
      });

      if (project?.ownerId === userId) {
        return res.status(400).json({ error: "cannot remove project owner" });
      }

      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId, userId } },
      });

      res.json({ removed: true });
    } catch (err) {
      res.status(404).json({ error: "member not found" });
    }
  }
);

// Delete comment (author or project owner)
apiRouter.delete("/comments/:commentId", requireAuth, validate(deleteCommentSchema), async (req, res) => {
  try {
    const { commentId } = req.validated.params;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, ticketId: true },
    });

    if (!comment) return res.status(404).json({ error: "comment not found" });

    if (comment.authorId === req.user.userId) {
      await prisma.comment.delete({ where: { id: commentId } });
      return res.json({ deleted: true });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: comment.ticketId },
      select: { projectId: true },
    });

    if (!ticket) return res.status(404).json({ error: "ticket not found" });

    const role = await getProjectRole(ticket.projectId, req.user.userId);
    if (role !== "OWNER") return res.status(403).json({ error: "forbidden" });

    await prisma.comment.delete({ where: { id: commentId } });
    return res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== USER MANAGEMENT (admin-only) ====================

// List users (admin-only, paginated, searchable)
apiRouter.get(
  "/users",
  requireAuth,
  requireAdmin,
  validate(listUsersSchema),
  async (req, res) => {
    try {
      const { q, page = 1, pageSize = 20 } = req.validated.query;
      const skip = (page - 1) * pageSize;

      const where = q
        ? {
            OR: [
              { email: { contains: q } },
              { name: { contains: q } },
            ],
          }
        : {};

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: { id: true, email: true, name: true, role: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
      ]);

      res.json({
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        users,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Get single user by ID
apiRouter.get(
  "/users/:userId",
  requireAuth,
  validate(getUserSchema),
  async (req, res) => {
    try {
      const { userId } = req.validated.params;

      // Users can view their own profile; admins can view anyone
      if (req.user.userId !== userId) {
        const currentUser = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { role: true },
        });
        if (!currentUser || currentUser.role !== "ADMIN") {
          return res.status(403).json({ error: "forbidden: admin access required" });
        }
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
      });

      if (!user) return res.status(404).json({ error: "user not found" });

      res.json(user);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Update user profile (admin or self)
apiRouter.put(
  "/users/:userId",
  requireAuth,
  validate(updateUserSchema),
  async (req, res) => {
    try {
      const { userId } = req.validated.params;
      const { name, email, role: newRole } = req.validated.body;

      // Only admin can change roles; users can update their own name/email
      const isSelf = req.user.userId === userId;
      const currentUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { role: true },
      });

      const isAdmin = currentUser?.role === "ADMIN";

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: "forbidden" });
      }

      // Only admin can change role
      if (newRole && !isAdmin) {
        return res.status(403).json({ error: "forbidden: only admins can change roles" });
      }

      // Check email uniqueness if changing email
      if (email) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing && existing.id !== userId) {
          return res.status(409).json({ error: "email already in use" });
        }
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { name, email, ...(isAdmin && newRole ? { role: newRole } : {}) },
        select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Delete/deactivate user (admin-only)
apiRouter.delete(
  "/users/:userId",
  requireAuth,
  requireAdmin,
  validate(getUserSchema),
  async (req, res) => {
    try {
      const { userId } = req.validated.params;

      // Prevent self-deletion
      if (userId === req.user.userId) {
        return res.status(400).json({ error: "cannot delete your own account" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) return res.status(404).json({ error: "user not found" });

      // Hard delete — cascading will handle related records
      await prisma.user.delete({ where: { id: userId } });

      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// ==================== DASHBOARD STATS ====================

apiRouter.get(
  "/dashboard/stats",
  requireAuth,
  validate(dashboardStatsSchema),
  async (req, res) => {
    try {
      const { projectId } = req.validated.query;

      // Build the where clause — only show tickets from projects the user belongs to
      const userProjects = await prisma.project.findMany({
        where: {
          OR: [
            { ownerId: req.user.userId },
            { members: { some: { userId: req.user.userId } } },
          ],
        },
        select: { id: true },
      });

      const userProjectIds = userProjects.map((p) => p.id);

      // If projectId filter is provided, verify the user has access
      if (projectId) {
        if (!userProjectIds.includes(projectId)) {
          return res.status(404).json({ error: "project not found" });
        }
      }

      const ticketWhere = {
        projectId: projectId
          ? projectId
          : { in: userProjectIds },
      };

      // Run all queries in parallel
      const [
        totalTickets,
        ticketsByStatus,
        ticketsByPriority,
        ticketsByType,
        myTickets,
        recentActivity,
      ] = await Promise.all([
        prisma.ticket.count({ where: ticketWhere }),

        // Tickets by status
        prisma.ticket.groupBy({
          by: ["status"],
          where: ticketWhere,
          _count: { id: true },
        }),

        // Tickets by priority
        prisma.ticket.groupBy({
          by: ["priority"],
          where: ticketWhere,
          _count: { id: true },
        }),

        // Tickets by type
        prisma.ticket.groupBy({
          by: ["type"],
          where: ticketWhere,
          _count: { id: true },
        }),

        // Tickets assigned to current user
        prisma.ticket.count({
          where: {
            ...ticketWhere,
            assigneeId: req.user.userId,
          },
        }),

        // Recent activity
        prisma.ticketActivity.findMany({
          where: {
            ticket: {
              projectId: projectId
                ? projectId
                : { in: userProjectIds },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            actor: { select: { id: true, email: true, name: true } },
            ticket: { select: { id: true, title: true, projectId: true } },
          },
        }),
      ]);

      // Format the response
      const formatGrouped = (data, key) => {
        const result = {};
        data.forEach((item) => {
          result[item[key]] = item._count.id;
        });
        return result;
      };

      res.json({
        totalTickets,
        ticketsByStatus: formatGrouped(ticketsByStatus, "status"),
        ticketsByPriority: formatGrouped(ticketsByPriority, "priority"),
        ticketsByType: formatGrouped(ticketsByType, "type"),
        myTickets,
        recentActivity,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// ==================== ORGANIZATION CRUD ====================

// Create organization
apiRouter.post(
  "/organizations",
  requireAuth,
  validate(createOrgSchema),
  async (req, res) => {
    try {
      const { name, description } = req.validated.body;

      const org = await prisma.organization.create({
        data: {
          name,
          description,
          ownerId: req.user.userId,
        },
      });

      // Also add creator as an OWNER member
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: req.user.userId,
          role: "OWNER",
        },
      });

      res.status(201).json(org);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Get organization details
apiRouter.get(
  "/organizations/:orgId",
  requireAuth,
  validate(getOrgSchema),
  requireOrgRole("MEMBER"),
  async (req, res) => {
    try {
      const { orgId } = req.validated.params;

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        include: {
          owner: { select: { id: true, email: true, name: true } },
          _count: { select: { members: true, projects: true } },
        },
      });

      if (!org) return res.status(404).json({ error: "organization not found" });

      res.json(org);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Update organization
apiRouter.put(
  "/organizations/:orgId",
  requireAuth,
  validate(updateOrgSchema),
  requireOrgRole("ADMIN"),
  async (req, res) => {
    try {
      const { orgId } = req.validated.params;
      const { name, description } = req.validated.body;

      const updated = await prisma.organization.update({
        where: { id: orgId },
        data: { name, description },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// List organization members
apiRouter.get(
  "/organizations/:orgId/members",
  requireAuth,
  validate(listOrgMembersSchema),
  requireOrgRole("MEMBER"),
  async (req, res) => {
    try {
      const { orgId } = req.validated.params;

      const members = await prisma.organizationMember.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });

      res.json(members);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// ==================== INVITES ====================

// --- Zod schemas ---

const createOrgInviteSchema = z.object({
  body: z.object({
    email: z.string().email(),
    role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  }),
  params: z.object({
    orgId: z.string().min(1),
  }),
  query: z.any(),
});

const createProjectInviteSchema = z.object({
  body: z.object({
    email: z.string().email(),
    role: z.enum(["OWNER", "MEMBER"]),
  }),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const getInviteByTokenSchema = z.object({
  body: z.any(),
  params: z.object({
    token: z.string().min(1),
  }),
  query: z.any(),
});

const listOrgInvitesSchema = z.object({
  body: z.any(),
  params: z.object({
    orgId: z.string().min(1),
  }),
  query: z.any(),
});

const listProjectInvitesSchema = z.object({
  body: z.any(),
  params: z.object({
    projectId: z.string().min(1),
  }),
  query: z.any(),
});

const cancelInviteSchema = z.object({
  body: z.any(),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.any(),
});

// --- Helpers ---

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// --- Org Invites ---

// POST /organizations/:orgId/invites – send invite by email with role (admin-only)
apiRouter.post(
  "/organizations/:orgId/invites",
  requireAuth,
  validate(createOrgInviteSchema),
  requireOrgRole("ADMIN"),
  async (req, res) => {
    try {
      const { orgId } = req.validated.params;
      const { email, role } = req.validated.body;

      // Check if user is already a member
      const existingMember = await prisma.organizationMember.findFirst({
        where: {
          organizationId: orgId,
          user: { email },
        },
      });

      if (existingMember) {
        return res.status(409).json({ error: "user is already a member of this organization" });
      }

      // Check for existing pending invite for the same email+org
      const existingInvite = await prisma.invite.findFirst({
        where: {
          email,
          organizationId: orgId,
          status: "PENDING",
        },
      });

      if (existingInvite) {
        return res.status(409).json({ error: "a pending invite already exists for this email" });
      }

      const token = generateToken();

      const invite = await prisma.invite.create({
        data: {
          email,
          token,
          role,
          organizationId: orgId,
          invitedById: req.user.userId,
        },
        include: {
          invitedBy: { select: { id: true, email: true, name: true } },
          organization: { select: { id: true, name: true } },
        },
      });

      // Create INVITE notification if the invited user exists
      const invitedUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (invitedUser && invitedUser.id !== req.user.userId) {
        const org = await prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true },
        });
        await createNotification({
          userId: invitedUser.id,
          type: "INVITE",
          title: "Organization invitation",
          body: `You've been invited to join "${org?.name || 'an organization'}"`,
        });
      }

      res.status(201).json(invite);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// GET /organizations/:orgId/invites – list pending invites (admin-only)
apiRouter.get(
  "/organizations/:orgId/invites",
  requireAuth,
  validate(listOrgInvitesSchema),
  requireOrgRole("ADMIN"),
  async (req, res) => {
    try {
      const { orgId } = req.validated.params;

      const invites = await prisma.invite.findMany({
        where: {
          organizationId: orgId,
          status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
        include: {
          invitedBy: { select: { id: true, email: true, name: true } },
        },
      });

      res.json(invites);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// --- Project Invites ---

// POST /projects/:projectId/invites – send invite by email with role (owner-only)
apiRouter.post(
  "/projects/:projectId/invites",
  requireAuth,
  validate(createProjectInviteSchema),
  requireProjectRole("OWNER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;
      const { email, role } = req.validated.body;

      // Check if user is already a member
      const existingMember = await prisma.projectMember.findFirst({
        where: {
          projectId,
          user: { email },
        },
      });

      // Also check if user is the owner
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { owner: { select: { email: true } } },
      });

      if (existingMember || project?.owner?.email === email) {
        return res.status(409).json({ error: "user is already a member of this project" });
      }

      // Check for existing pending invite
      const existingInvite = await prisma.invite.findFirst({
        where: {
          email,
          projectId,
          status: "PENDING",
        },
      });

      if (existingInvite) {
        return res.status(409).json({ error: "a pending invite already exists for this email" });
      }

      const token = generateToken();

      const invite = await prisma.invite.create({
        data: {
          email,
          token,
          role,
          projectId,
          invitedById: req.user.userId,
        },
        include: {
          invitedBy: { select: { id: true, email: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      });

      // Create INVITE notification if the invited user exists
      const invitedUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (invitedUser && invitedUser.id !== req.user.userId) {
        const proj = await prisma.project.findUnique({
          where: { id: projectId },
          select: { name: true },
        });
        await createNotification({
          userId: invitedUser.id,
          type: "INVITE",
          title: "Project invitation",
          body: `You've been invited to join "${proj?.name || 'a project'}"`,
          projectId,
        });
      }

      res.status(201).json(invite);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// GET /projects/:projectId/invites – list pending invites
apiRouter.get(
  "/projects/:projectId/invites",
  requireAuth,
  validate(listProjectInvitesSchema),
  requireProjectRole("OWNER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;

      const invites = await prisma.invite.findMany({
        where: {
          projectId,
          status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
        include: {
          invitedBy: { select: { id: true, email: true, name: true } },
        },
      });

      res.json(invites);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// --- Shared invite endpoints ---

// GET /invites/:token – look up invite by token (public – no auth, returns org/project name and role)
apiRouter.get(
  "/invites/:token",
  validate(getInviteByTokenSchema),
  async (req, res) => {
    try {
      const { token } = req.validated.params;

      const invite = await prisma.invite.findUnique({
        where: { token },
        include: {
          organization: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          invitedBy: { select: { id: true, email: true, name: true } },
        },
      });

      if (!invite) {
        return res.status(404).json({ error: "invite not found" });
      }

      if (invite.status !== "PENDING") {
        return res.status(410).json({ error: `invite is ${invite.status.toLowerCase()}` });
      }

      res.json(invite);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// POST /invites/:token/accept – accept invite (requires auth)
apiRouter.post(
  "/invites/:token/accept",
  requireAuth,
  validate(getInviteByTokenSchema),
  async (req, res) => {
    try {
      const { token } = req.validated.params;

      const invite = await prisma.invite.findUnique({
        where: { token },
      });

      if (!invite) {
        return res.status(404).json({ error: "invite not found" });
      }

      if (invite.status !== "PENDING") {
        return res.status(410).json({ error: `invite is ${invite.status.toLowerCase()}` });
      }

      // Verify the authenticated user's email matches the invite
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { email: true },
      });

      if (!user || user.email !== invite.email) {
        return res.status(403).json({
          error: "this invite is for a different email address. Please log in with the invited email.",
        });
      }

      // Accept: add member and mark invite
      if (invite.organizationId) {
        await prisma.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId: invite.organizationId,
              userId: req.user.userId,
            },
          },
          update: { role: invite.role },
          create: {
            organizationId: invite.organizationId,
            userId: req.user.userId,
            role: invite.role,
          },
        });
      }

      if (invite.projectId) {
        const projectRole = invite.role === "OWNER" ? "OWNER" : "MEMBER";
        await prisma.projectMember.upsert({
          where: {
            projectId_userId: {
              projectId: invite.projectId,
              userId: req.user.userId,
            },
          },
          update: { role: projectRole },
          create: {
            projectId: invite.projectId,
            userId: req.user.userId,
            role: projectRole,
          },
        });
      }

      const updated = await prisma.invite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED" },
        include: {
          organization: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// DELETE /invites/:id – cancel an invite (checks ownership by looking up invite)
apiRouter.delete(
  "/invites/:id",
  requireAuth,
  validate(cancelInviteSchema),
  async (req, res) => {
    try {
      const { id } = req.validated.params;

      const invite = await prisma.invite.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          organizationId: true,
          projectId: true,
        },
      });

      if (!invite) {
        return res.status(404).json({ error: "invite not found" });
      }

      if (invite.status !== "PENDING") {
        return res.status(400).json({ error: "only pending invites can be cancelled" });
      }

      // Check authorization: must be admin of the org or owner of the project
      if (invite.organizationId) {
        const org = await prisma.organization.findUnique({
          where: { id: invite.organizationId },
          select: { ownerId: true },
        });

        if (!org || org.ownerId !== req.user.userId) {
          const member = await prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId: invite.organizationId,
                userId: req.user.userId,
              },
            },
            select: { role: true },
          });

          if (!member || (member.role !== "ADMIN" && member.role !== "OWNER")) {
            return res.status(403).json({ error: "forbidden" });
          }
        }
      } else if (invite.projectId) {
        const role = await getProjectRole(invite.projectId, req.user.userId);
        if (role !== "OWNER") {
          return res.status(403).json({ error: "forbidden" });
        }
      } else {
        return res.status(400).json({ error: "invalid invite" });
      }

      const updated = await prisma.invite.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// GET /invites/pending – list pending invites for the authenticated user (by email)
apiRouter.get("/invites/pending", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true },
    });

    if (!user) return res.status(404).json({ error: "user not found" });

    const invites = await prisma.invite.findMany({
      where: {
        email: user.email,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      include: {
        organization: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, email: true, name: true } },
      },
    });

    res.json(invites);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== NOTIFICATIONS ====================

// Zod schemas for notifications
const listNotificationsSchema = z.object({
  body: z.any(),
  params: z.any(),
  query: z.object({
    unread: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

const markReadSchema = z.object({
  body: z.any(),
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.any(),
});

// GET /notifications — list user's notifications (paginated, newest first, filterable by read/unread)
apiRouter.get(
  "/notifications",
  requireAuth,
  validate(listNotificationsSchema),
  async (req, res) => {
    try {
      const { unread, page = 1, pageSize = 20 } = req.validated.query;
      const skip = (page - 1) * pageSize;

      const where = {
        userId: req.user.userId,
        ...(unread === "true" ? { read: false } : unread === "false" ? { read: true } : {}),
      };

      const [total, notifications] = await Promise.all([
        prisma.notification.count({ where }),
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
          include: {
            ticket: { select: { id: true, title: true } },
          },
        }),
      ]);

      res.json({
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        notifications,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// GET /notifications/unread-count — return { count: N } for the badge
apiRouter.get("/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.userId, read: false },
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /notifications/:id/read — mark single notification as read
apiRouter.put(
  "/notifications/:id/read",
  requireAuth,
  validate(markReadSchema),
  async (req, res) => {
    try {
      const { id } = req.validated.params;

      const notification = await prisma.notification.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!notification) return res.status(404).json({ error: "notification not found" });
      if (notification.userId !== req.user.userId) return res.status(403).json({ error: "forbidden" });

      const updated = await prisma.notification.update({
        where: { id },
        data: { read: true },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// PUT /notifications/read-all — mark all as read
apiRouter.put("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------- BILLING ENDPOINTS --------------------

// GET /api/billing/plan — returns current user's plan
apiRouter.get("/billing/plan", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { plan: true, stripeCustomerId: true },
    });
    res.json({ plan: user?.plan || "free", stripeCustomerId: user?.stripeCustomerId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/billing/create-checkout-session — creates Stripe checkout session
apiRouter.post("/billing/create-checkout-session", requireAuth, async (req, res) => {
  try {
    let { priceId } = req.body;
    if (!priceId) return res.status(400).json({ error: "priceId is required" });

    // Map plan names to price IDs
    if (priceId === "pro") priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (priceId === "enterprise") priceId = process.env.STRIPE_ENTERPRISE_PRICE_ID;

    if (!priceId || priceId === "pro" || priceId === "enterprise") {
      return res.status(400).json({ error: "Invalid plan — Stripe products may not be configured yet. Please try again." });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, name: true, stripeCustomerId: true },
    });

    if (!user) return res.status(404).json({ error: "user not found" });

    // Get or create Stripe customer
    const customerId = await getOrCreateCustomer(user);

    // Save stripeCustomerId if new
    if (!user.stripeCustomerId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const appUrl = process.env.APP_URL || `https://${req.get("host")}`;

    const session = await createCheckoutSession({
      customerId,
      priceId,
      userId: user.id,
      appUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[Billing] Checkout error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/billing/create-portal-session — creates Stripe customer portal
apiRouter.post("/billing/create-portal-session", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: "no Stripe customer found — please start a subscription first" });
    }

    const appUrl = process.env.APP_URL || `https://${req.get("host")}`;

    const session = await createPortalSession({
      customerId: user.stripeCustomerId,
      appUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[Billing] Portal error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// -------------------- ERROR HANDLER --------------------

// 404 handler for unmatched API routes
apiRouter.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

app.use("/api", apiRouter);

// ─── Stripe Webhook (raw body required — mounted directly on app) ───
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    const signature = req.headers["stripe-signature"];
    event = verifyWebhook(req.body, signature);
  } catch (err) {
    console.error("[Webhook] Signature verification failed:", err.message);
    return res.status(400).json({ error: "webhook signature verification failed" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Get the price ID from the subscription
        let priceId = null;
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          priceId = subscription.items.data[0]?.price?.id;
        } else if (session.line_items) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          priceId = lineItems.data[0]?.price?.id;
        }

        const plan = planFromPriceId(priceId);

        // Find user by stripeCustomerId
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { plan },
          });
          console.log(`[Webhook] Upgraded user ${user.email} to plan: ${plan}`);
        } else {
          // Try metadata on subscription
          const userIdFromMeta = session.metadata?.userId;
          if (userIdFromMeta) {
            await prisma.user.update({
              where: { id: userIdFromMeta },
              data: { plan, stripeCustomerId: customerId },
            });
            console.log(`[Webhook] Upgraded user ${userIdFromMeta} to plan: ${plan} (via metadata)`);
          } else {
            console.log(`[Webhook] No user found for customer: ${customerId}`);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { plan: "free" },
          });
          console.log(`[Webhook] Downgraded user ${user.email} to free (subscription cancelled)`);
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[Webhook] Handler error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.use((err, req, res, next) => {
  console.error(err);

  const status = err?.statusCode || err?.status || 500;

  if (err?.name === "ZodError") {
    return res.status(400).json({ error: "validation_error", details: err.issues });
  }

  res.status(status).json({
    error: "internal_server_error",
    message: process.env.NODE_ENV === "production" ? undefined : String(err),
  });
});

// -------------------- STATIC FILES & SPA --------------------

// Landing page at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "landing.html"));
});

// Landing page static assets (CSS, JS from TanStack Start build)
app.use("/assets", express.static(path.join(__dirname, "..", "..", "site", "dist", "client", "assets")));

// Frontend SPA static files
const spaDist = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(spaDist));

// SPA catch-all for client-side routing
app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(spaDist, "index.html"));
});

// -------------------- START SERVER --------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);

  // Auto-migrate DB schema
  await autoMigrate();

  // Ensure Stripe products exist (test mode)
  if (process.env.STRIPE_SECRET_KEY) {
    await ensureStripeProducts();
  }
});
