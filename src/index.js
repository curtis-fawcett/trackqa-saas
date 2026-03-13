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

async function logActivity({ ticketId, actorId, type, message }) {
  return prisma.ticketActivity.create({
    data: { ticketId, actorId, type, message },
  });
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

// -------------------- APP SETUP --------------------

const app = express();

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

app.get("/", (req, res) => {
  res.send("TrackQA API is running ✅");
});

app.get("/health/db", async (req, res) => {
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

const createTicketSchema = z.object({
  body: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: TicketPriority.optional(),
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

const searchUsersSchema = z.object({
  body: z.any(),
  params: z.any(),
  query: z.object({
    q: z.string().min(1, "search query is required"),
  }),
});

// -------------------- ROUTES --------------------

// Activity
app.get(
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
app.post("/auth/register", validate(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.validated.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "email already registered" });

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, password: hashed, name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Login
app.post("/auth/login", validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.validated.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "invalid credentials" });

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Me
app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  res.json(user);
});

// Search users
app.get("/users", requireAuth, validate(searchUsersSchema), async (req, res) => {
  try {
    const { q } = req.validated.query;

    const users = await prisma.user.findMany({
      where: {
        OR: [{ email: { contains: q } }, { name: { contains: q } }],
      },
      take: 10,
      select: { id: true, email: true, name: true },
    });

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create project
app.post("/projects", requireAuth, validate(createProjectSchema), async (req, res) => {
  try {
    const { name, description } = req.validated.body;

    const project = await prisma.project.create({
      data: { name, description, ownerId: req.user.userId },
    });

    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List my projects
app.get("/projects", requireAuth, async (req, res) => {
  const projects = await prisma.project.findMany({
    where: {
      OR: [{ ownerId: req.user.userId }, { members: { some: { userId: req.user.userId } } }],
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(projects);
});

// Get one project (details)
app.get(
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

// Create ticket
app.post(
  "/projects/:projectId/tickets",
  requireAuth,
  validate(createTicketSchema),
  requireProjectRole("MEMBER"),
  async (req, res, next) => {
    try {
      const { projectId } = req.validated.params;
      const { title, description, priority } = req.validated.body;

      const ticket = await prisma.ticket.create({
        data: {
          title,
          description,
          priority,
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
app.get(
  "/projects/:projectId/tickets",
  requireAuth,
  validate(listTicketsSchema),
  requireProjectRole("MEMBER"),
  async (req, res) => {
    try {
      const { projectId } = req.validated.params;
      const { status, priority, q, sort = "createdAt:desc", page = 1, pageSize = 20 } =
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
app.get(
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
app.patch(
  "/tickets/:ticketId",
  requireAuth,
  validate(updateTicketSchema),
  requireTicketRole("MEMBER"),
  async (req, res) => {
    const { ticketId } = req.validated.params;
    const { title, description, status, priority } = req.validated.body;

    const before = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true, description: true, status: true, priority: true },
    });

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { title, description, status, priority },
    });

    const changes = [];
    if (title && title !== before.title) changes.push("title");
    if (description !== undefined && description !== before.description) changes.push("description");
    if (status && status !== before.status) changes.push(`status ${before.status} → ${status}`);
    if (priority && priority !== before.priority)
      changes.push(`priority ${before.priority} → ${priority}`);

    if (changes.length) {
      await logActivity({
        ticketId,
        actorId: req.user.userId,
        type: "TICKET_UPDATED",
        message: `Updated: ${changes.join(", ")}`,
      });
    }

    res.json(updated);
  }
);

// Delete ticket
app.delete("/tickets/:ticketId", requireAuth, requireTicketRole("OWNER"), async (req, res) => {
  const { ticketId } = req.params;
  await prisma.ticket.delete({ where: { id: ticketId } });
  res.json({ deleted: true });
});

// Create comment
app.post(
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

      res.status(201).json(comment);
    } catch (err) {
      next(err);
    }
  }
);

// List comments
app.get(
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
app.patch(
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

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

// Add member (owner)
app.post(
  "/projects/:projectId/members",
  requireAuth,
  validate(addMemberSchema),
  requireProjectRole("OWNER"),
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
app.get("/projects/:projectId/members", requireAuth, validate(listMembersSchema), async (req, res) => {
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
app.delete(
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
app.delete("/comments/:commentId", requireAuth, validate(deleteCommentSchema), async (req, res) => {
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

// -------------------- ERROR HANDLER --------------------

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

// -------------------- START SERVER --------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});