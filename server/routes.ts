import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { storage } from "./storage";
import { 
  insertTaskSchema, insertClientSchema, insertTaskStatusSchema, 
  insertTaskCategorySchema, insertAnnouncementSchema, insertTaskCommentSchema,
  insertTimeEntrySchema, insertUserSchema, insertChatChannelSchema,
  insertChatMessageSchema, insertDirectMessageSchema,
  insertLeadSchema, insertLeadActivitySchema, insertLeadFileSchema,
  insertApiKeySchema, insertPipelineStageSchema, insertLeadSourceSchema
} from "@shared/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendWelcomeEmail } from "./email";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const SALT_ROUNDS = 10;

// Sanitize user data to remove sensitive fields
function sanitizeUser(user: any) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId: string;
    userRole: string;
  }
}

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (req.session.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function requireSalesAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  // Admin and sales roles can access sales funnel
  if (req.session.userRole !== "admin" && req.session.userRole !== "sales") {
    return res.status(403).json({ error: "Sales access required" });
  }
  next();
}

// WebSocket connections for real-time updates
const wsClients = new Set<WebSocket>();

function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== Health Check ====================
  app.get("/api/health", (_req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // ==================== Authentication ====================
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Set session
      req.session.userId = user.id;
      req.session.userRole = user.role;

      // Return user without password
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: "User not found" });
      }

      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error) {
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // Validate password reset token
  app.get("/api/auth/validate-token/:token", async (req, res) => {
    try {
      const user = await storage.getUserByResetToken(req.params.token);
      if (!user) {
        return res.status(400).json({ valid: false, error: "Invalid token" });
      }
      
      if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
        return res.status(400).json({ valid: false, error: "Token has expired" });
      }
      
      res.json({ valid: true, name: user.name, username: user.username });
    } catch (error) {
      res.status(500).json({ valid: false, error: "Failed to validate token" });
    }
  });

  // Set password from welcome email link
  app.post("/api/auth/setup-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password are required" });
      }
      
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({ error: "Invalid token" });
      }
      
      if (user.passwordResetExpires && new Date(user.passwordResetExpires) < new Date()) {
        return res.status(400).json({ error: "Token has expired. Please contact your administrator." });
      }
      
      // Hash the new password and update user
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      await storage.updateUser(user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        isPasswordSet: true,
      });
      
      res.json({ success: true, message: "Password set successfully. You can now log in." });
    } catch (error) {
      console.error("Password setup error:", error);
      res.status(500).json({ error: "Failed to set password" });
    }
  });

  // ==================== Users ====================
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Remove passwords from response
      const safeUsers = users.map(({ password, ...user }) => user);
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const parsed = insertUserSchema.parse(req.body);
      
      // Check if username already exists
      const existing = await storage.getUserByUsername(parsed.username);
      if (existing) {
        return res.status(400).json({ error: "Username already exists" });
      }
      
      // Generate a temporary password (user will set their own via email link)
      const tempPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);
      
      // Generate password reset token (valid for 24 hours)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      const user = await storage.createUser({
        ...parsed,
        password: hashedPassword,
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
        isPasswordSet: false,
      });
      
      // Send welcome email if user has email
      if (parsed.email) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        sendWelcomeEmail(parsed.email, parsed.name, resetToken, baseUrl)
          .catch(err => console.error('Failed to send welcome email:', err));
      }
      
      const { password: _, passwordResetToken: __, ...safeUser } = user;
      broadcast("user_created", safeUser);
      res.json(safeUser);
    } catch (error) {
      console.error("User creation error:", error);
      res.status(400).json({ error: "Invalid user data" });
    }
  });

  app.get("/api/users/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(sanitizeUser(user));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const updateData = { ...req.body };
      
      // Hash password if it's being updated
      if (updateData.password) {
        updateData.password = await bcrypt.hash(updateData.password, SALT_ROUNDS);
      }
      
      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const { password: _, ...safeUser } = user;
      broadcast("user_updated", safeUser);
      res.json(safeUser);
    } catch (error) {
      res.status(400).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      // Prevent deleting yourself
      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      await storage.deleteUser(req.params.id);
      broadcast("user_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Seed default admin user
  app.post("/api/seed-admin", async (req, res) => {
    try {
      const existingAdmin = await storage.getUserByUsername("admin");
      if (existingAdmin) {
        return res.json({ message: "Admin user already exists" });
      }
      
      const hashedPassword = await bcrypt.hash("admin", SALT_ROUNDS);
      const admin = await storage.createUser({
        username: "admin",
        password: hashedPassword,
        name: "Administrator",
        email: "admin@taskflow.com",
        role: "admin",
        hourlyRate: 0,
      });
      
      const { password: _, ...safeAdmin } = admin;
      res.json({ message: "Admin user created", user: safeAdmin });
    } catch (error) {
      console.error("Seed admin error:", error);
      res.status(500).json({ error: "Failed to create admin user" });
    }
  });

  // ==================== Task Statuses ====================
  app.get("/api/task-statuses", async (req, res) => {
    try {
      const statuses = await storage.getAllTaskStatuses();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task statuses" });
    }
  });

  app.post("/api/task-statuses", async (req, res) => {
    try {
      const parsed = insertTaskStatusSchema.parse(req.body);
      const status = await storage.createTaskStatus(parsed);
      res.json(status);
    } catch (error) {
      res.status(400).json({ error: "Invalid task status data" });
    }
  });

  // ==================== Task Categories ====================
  app.get("/api/task-categories", async (req, res) => {
    try {
      const categories = await storage.getAllTaskCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task categories" });
    }
  });

  app.post("/api/task-categories", async (req, res) => {
    try {
      const parsed = insertTaskCategorySchema.parse(req.body);
      const category = await storage.createTaskCategory(parsed);
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: "Invalid task category data" });
    }
  });

  // ==================== Clients ====================
  app.get("/api/clients", async (req, res) => {
    try {
      const clients = await storage.getAllClients();
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/:id", async (req, res) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const parsed = insertClientSchema.parse(req.body);
      const client = await storage.createClient(parsed);
      res.json(client);
    } catch (error) {
      res.status(400).json({ error: "Invalid client data" });
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    try {
      const client = await storage.updateClient(req.params.id, req.body);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      res.status(400).json({ error: "Failed to update client" });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      await storage.deleteClient(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete client" });
    }
  });

  app.get("/api/clients/:id/tasks", async (req, res) => {
    try {
      const tasks = await storage.getTasksByClient(req.params.id);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client tasks" });
    }
  });

  app.get("/api/clients/:id/team", async (req, res) => {
    try {
      const assignments = await storage.getClientAssignments(req.params.id);
      res.json(assignments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client team" });
    }
  });

  // Client Income History
  app.get("/api/clients/:id/income-history", async (req, res) => {
    try {
      const history = await storage.getClientIncomeHistory(req.params.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch income history" });
    }
  });

  app.post("/api/clients/:id/income-history", requireAdmin, async (req, res) => {
    try {
      const { amount, effectiveDate } = req.body;
      
      // Validate input
      if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
        return res.status(400).json({ error: "Amount must be a valid non-negative number" });
      }
      if (!effectiveDate || isNaN(new Date(effectiveDate).getTime())) {
        return res.status(400).json({ error: "Valid effective date is required" });
      }
      
      // Verify client exists
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      const entry = await storage.addClientIncomeHistory({
        clientId: req.params.id,
        amount,
        effectiveDate: new Date(effectiveDate),
      });
      res.json(entry);
    } catch (error) {
      console.error("Failed to add income history:", error);
      res.status(500).json({ error: "Failed to add income history" });
    }
  });

  // ==================== Tasks ====================
  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = await storage.getAllTasks();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const parsed = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(parsed);
      broadcast("task_created", task);
      res.json(task);
    } catch (error) {
      res.status(400).json({ error: "Invalid task data" });
    }
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.updateTask(req.params.id, req.body);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      broadcast("task_updated", task);
      res.json(task);
    } catch (error) {
      res.status(400).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      await storage.deleteTask(req.params.id);
      broadcast("task_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ==================== Task Comments ====================
  app.get("/api/tasks/:id/comments", async (req, res) => {
    try {
      const comments = await storage.getTaskComments(req.params.id);
      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/tasks/:id/comments", async (req, res) => {
    try {
      const parsed = insertTaskCommentSchema.parse({
        ...req.body,
        taskId: req.params.id
      });
      const comment = await storage.createTaskComment(parsed);
      res.json(comment);
    } catch (error) {
      res.status(400).json({ error: "Invalid comment data" });
    }
  });

  // ==================== Time Entries ====================
  app.get("/api/tasks/:id/time-entries", async (req, res) => {
    try {
      const entries = await storage.getTimeEntriesByTask(req.params.id);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  app.post("/api/tasks/:id/time-entries", async (req, res) => {
    try {
      const parsed = insertTimeEntrySchema.parse({
        ...req.body,
        taskId: req.params.id
      });
      const entry = await storage.createTimeEntry(parsed);
      res.json(entry);
    } catch (error) {
      res.status(400).json({ error: "Invalid time entry data" });
    }
  });

  app.patch("/api/tasks/:id/time", async (req, res) => {
    try {
      const { minutes } = req.body;
      await storage.updateTaskTimeTracked(req.params.id, minutes);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to update time tracked" });
    }
  });

  // ==================== Announcements ====================
  app.get("/api/announcements", async (req, res) => {
    try {
      const announcements = await storage.getAllAnnouncements();
      res.json(announcements);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch announcements" });
    }
  });

  app.post("/api/announcements", async (req, res) => {
    try {
      const parsed = insertAnnouncementSchema.parse(req.body);
      const announcement = await storage.createAnnouncement(parsed);
      res.json(announcement);
    } catch (error) {
      res.status(400).json({ error: "Invalid announcement data" });
    }
  });

  // ==================== AI Suggestions (Gemini) ====================
  app.post("/api/ai/suggest-task", async (req, res) => {
    try {
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Task title is required" });
      }

      const categories = await storage.getAllTaskCategories();
      const categoryNames = categories.map(c => c.name).join(", ");

      const prompt = `You are a helpful assistant for a digital marketing agency task management system.

Given a task title, suggest:
1. A detailed description for this task (2-3 sentences)
2. The most appropriate category from: ${categoryNames || "Google PPC, Facebook Ads, SEO, Content Creation, Social Media, Analytics, Email Marketing"}
3. An estimated time to complete in hours (1-40)

Task title: "${title}"

Respond in JSON format only:
{
  "description": "...",
  "category": "...",
  "estimatedTime": number
}`;

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text() || "";
      
      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const suggestion = JSON.parse(jsonMatch[0]);
        res.json(suggestion);
      } else {
        res.json({
          description: `Complete the task: ${title}`,
          category: "General",
          estimatedTime: 2
        });
      }
    } catch (error) {
      console.error("AI suggestion error:", error);
      res.status(500).json({ error: "Failed to generate suggestion" });
    }
  });

  app.post("/api/ai/generate-ad-copy", async (req, res) => {
    try {
      const { platform, productName, targetAudience, tone, keyFeatures } = req.body;
      
      if (!productName) {
        return res.status(400).json({ error: "Product name is required" });
      }

      const prompt = `You are an expert digital marketing copywriter.

Generate ad copy for the following:
- Platform: ${platform || "Facebook"}
- Product/Service: ${productName}
- Target Audience: ${targetAudience || "General audience"}
- Tone: ${tone || "Professional"}
- Key Features: ${keyFeatures || "Not specified"}

Generate 3 variations of ad copy suitable for the platform. Include:
1. A headline (short and catchy)
2. Primary text/body copy
3. A call-to-action

Respond in JSON format:
{
  "variations": [
    {
      "headline": "...",
      "body": "...",
      "callToAction": "..."
    }
  ]
}`;

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text() || "";
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const adCopy = JSON.parse(jsonMatch[0]);
        res.json(adCopy);
      } else {
        res.json({
          variations: [{
            headline: `Discover ${productName}`,
            body: `Experience the best with ${productName}. Perfect for ${targetAudience || "everyone"}.`,
            callToAction: "Learn More"
          }]
        });
      }
    } catch (error) {
      console.error("Ad copy generation error:", error);
      res.status(500).json({ error: "Failed to generate ad copy" });
    }
  });

  // ==================== Chat Channels ====================
  app.get("/api/chat-channels", async (req, res) => {
    try {
      const channels = await storage.getAllChatChannels();
      res.json(channels);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat channels" });
    }
  });

  app.post("/api/chat-channels", async (req, res) => {
    try {
      const { memberIds, ...channelData } = req.body;
      const parsed = insertChatChannelSchema.parse(channelData);
      const channel = await storage.createChatChannel(parsed);
      
      // Add members to private channels
      if (parsed.isPrivate && Array.isArray(memberIds) && memberIds.length > 0) {
        await storage.addChannelMembers(channel.id, memberIds);
      }
      
      broadcast("channel_created", channel);
      res.json(channel);
    } catch (error) {
      res.status(400).json({ error: "Invalid channel data" });
    }
  });

  // ==================== Chat Messages ====================
  app.get("/api/chat-channels/:id/messages", async (req, res) => {
    try {
      const messages = await storage.getChannelMessages(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/chat-channels/:id/messages", async (req, res) => {
    try {
      const parsed = insertChatMessageSchema.parse({
        ...req.body,
        channelId: req.params.id
      });
      const message = await storage.createChatMessage(parsed);
      broadcast("chat_message", message);
      res.json(message);
    } catch (error) {
      res.status(400).json({ error: "Invalid message data" });
    }
  });

  // ==================== Direct Messages ====================
  app.get("/api/dm/:userId", async (req, res) => {
    try {
      const currentUserId = req.query.currentUserId as string;
      if (!currentUserId) {
        return res.status(400).json({ error: "Current user ID required" });
      }
      const messages = await storage.getDirectMessages(currentUserId, req.params.userId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch direct messages" });
    }
  });

  app.post("/api/dm/:userId", async (req, res) => {
    try {
      const parsed = insertDirectMessageSchema.parse({
        ...req.body,
        receiverId: req.params.userId
      });
      const message = await storage.createDirectMessage(parsed);
      broadcast("direct_message", message);
      res.json(message);
    } catch (error) {
      res.status(400).json({ error: "Invalid message data" });
    }
  });

  // ==================== Time Tracking Reports ====================
  app.get("/api/time-entries", requireAuth, async (req, res) => {
    try {
      const { userId, startDate, endDate } = req.query;
      const sessionUserId = req.session.userId;
      const isAdmin = req.session.userRole === "admin";
      
      // Non-admins can only query their own data
      const targetUserId = isAdmin ? (userId as string | undefined) : sessionUserId;
      
      let entries;
      
      if (startDate && endDate) {
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        
        if (targetUserId) {
          entries = await storage.getUserTimeEntriesInDateRange(targetUserId, start, end);
        } else {
          entries = await storage.getTimeEntriesInDateRange(start, end);
        }
      } else if (targetUserId) {
        entries = await storage.getTimeEntriesByUser(targetUserId);
      } else {
        entries = await storage.getAllTimeEntries();
      }
      
      res.json(entries);
    } catch (error) {
      console.error("Time entries error:", error);
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  // Get labor costs by user for a month (admin only)
  app.get("/api/reports/labor-costs", requireAdmin, async (req, res) => {
    try {
      const { month, year } = req.query;
      const targetMonth = parseInt(month as string) || new Date().getMonth();
      const targetYear = parseInt(year as string) || new Date().getFullYear();
      
      const startDate = new Date(targetYear, targetMonth, 1);
      const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);
      
      const allEntries = await storage.getTimeEntriesInDateRange(startDate, endDate);
      const users = await storage.getAllUsers();
      const allTasks = await storage.getAllTasks();
      
      // Group entries by user and calculate costs
      const userCosts: { userId: string; userName: string; totalMinutes: number; hourlyRate: number; totalCost: number; entries: any[] }[] = [];
      
      for (const user of users) {
        const userEntries = allEntries.filter(e => e.userId === user.id);
        const totalMinutes = userEntries.reduce((sum, e) => sum + e.minutes, 0);
        const hours = totalMinutes / 60;
        const totalCost = Math.round(hours * (user.hourlyRate || 0) * 100) / 100;
        
        // Enrich entries with task info
        const enrichedEntries = userEntries.map(entry => {
          const task = allTasks.find(t => t.id === entry.taskId);
          return {
            ...entry,
            taskTitle: task?.title || "Unknown Task"
          };
        });
        
        userCosts.push({
          userId: user.id,
          userName: user.name,
          totalMinutes,
          hourlyRate: user.hourlyRate || 0,
          totalCost,
          entries: enrichedEntries
        });
      }
      
      // Filter out users with no time entries
      const filteredCosts = userCosts.filter(u => u.totalMinutes > 0);
      
      res.json({
        month: targetMonth,
        year: targetYear,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        userCosts: filteredCosts,
        totalCost: filteredCosts.reduce((sum, u) => sum + u.totalCost, 0),
        totalMinutes: filteredCosts.reduce((sum, u) => sum + u.totalMinutes, 0)
      });
    } catch (error) {
      console.error("Labor costs report error:", error);
      res.status(500).json({ error: "Failed to generate labor costs report" });
    }
  });

  // Get user's time tracking summary with task breakdowns
  app.get("/api/reports/my-time", requireAuth, async (req, res) => {
    try {
      const { userId, startDate, endDate } = req.query;
      const sessionUserId = req.session.userId;
      const isAdmin = req.session.userRole === "admin";
      
      // Non-admins can only query their own data
      const targetUserId = isAdmin ? (userId as string || sessionUserId) : sessionUserId;
      
      if (!targetUserId) {
        return res.status(400).json({ error: "User ID required" });
      }
      
      const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 7));
      const end = endDate ? new Date(endDate as string) : new Date();
      end.setHours(23, 59, 59, 999);
      
      const entries = await storage.getUserTimeEntriesInDateRange(targetUserId, start, end);
      const allTasks = await storage.getAllTasks();
      
      // Group by task
      const taskMap = new Map<string, { taskId: string; taskTitle: string; totalMinutes: number; entries: any[] }>();
      
      for (const entry of entries) {
        const task = allTasks.find(t => t.id === entry.taskId);
        const existing = taskMap.get(entry.taskId);
        
        if (existing) {
          existing.totalMinutes += entry.minutes;
          existing.entries.push(entry);
        } else {
          taskMap.set(entry.taskId, {
            taskId: entry.taskId,
            taskTitle: task?.title || "Unknown Task",
            totalMinutes: entry.minutes,
            entries: [entry]
          });
        }
      }
      
      const taskBreakdowns = Array.from(taskMap.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
      const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
      
      res.json({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 100) / 100,
        taskBreakdowns,
        entries
      });
    } catch (error) {
      console.error("My time report error:", error);
      res.status(500).json({ error: "Failed to generate time report" });
    }
  });

  // ==================== Client Labor Cost ====================
  app.get("/api/clients/:id/labor-cost", async (req, res) => {
    try {
      const cost = await storage.getClientLaborCost(req.params.id);
      res.json({ laborCost: cost });
    } catch (error) {
      res.status(500).json({ error: "Failed to calculate labor cost" });
    }
  });

  // ==================== Statistics Dashboard (Admin Only) ====================
  app.get("/api/statistics/monthly", requireAdmin, async (req, res) => {
    try {
      const { months = 12 } = req.query;
      const numMonths = Math.min(parseInt(months as string) || 12, 24);
      
      const users = await storage.getAllUsers();
      const clients = await storage.getAllClients();
      const allTasks = await storage.getAllTasks();
      
      const monthlyStats = [];
      const now = new Date();
      
      for (let i = 0; i < numMonths; i++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
        
        const monthName = startDate.toLocaleString('en-US', { month: 'short' });
        const label = `${monthName} ${year}`;
        
        // Get time entries for this month
        const timeEntries = await storage.getTimeEntriesInDateRange(startDate, endDate);
        
        // Calculate labor costs per user
        const laborByUser: { userId: string; userName: string; minutes: number; cost: number }[] = [];
        let totalLaborCost = 0;
        let totalMinutes = 0;
        
        for (const user of users) {
          const userEntries = timeEntries.filter(e => e.userId === user.id);
          const minutes = userEntries.reduce((sum, e) => sum + e.minutes, 0);
          const cost = Math.round((minutes / 60) * (user.hourlyRate || 0));
          if (minutes > 0) {
            laborByUser.push({
              userId: user.id,
              userName: user.name,
              minutes,
              cost
            });
            totalLaborCost += cost;
            totalMinutes += minutes;
          }
        }
        
        // Calculate income from clients using historical data
        const incomeByClient: { clientId: string; clientName: string; income: number }[] = [];
        let totalIncome = 0;
        
        for (const client of clients) {
          // Get income that was effective at the end of this month
          const income = await storage.getIncomeAtDate(client.id, endDate);
          if (income > 0) {
            incomeByClient.push({
              clientId: client.id,
              clientName: client.name,
              income
            });
            totalIncome += income;
          }
        }
        
        // Calculate profit
        const profit = totalIncome - totalLaborCost;
        
        monthlyStats.push({
          year,
          month,
          label,
          laborCost: totalLaborCost,
          laborByUser,
          totalMinutes,
          income: totalIncome,
          incomeByClient,
          profit
        });
      }
      
      res.json({
        monthlyStats: monthlyStats.reverse(), // Oldest first for charts
        summary: {
          totalLaborCost: monthlyStats.reduce((sum, m) => sum + m.laborCost, 0),
          totalIncome: monthlyStats.reduce((sum, m) => sum + m.income, 0),
          totalProfit: monthlyStats.reduce((sum, m) => sum + m.profit, 0)
        }
      });
    } catch (error) {
      console.error("Statistics error:", error);
      res.status(500).json({ error: "Failed to generate statistics" });
    }
  });

  // ==================== Seed Data ====================
  app.post("/api/seed", async (req, res) => {
    try {
      // Check if data already exists
      const existingStatuses = await storage.getAllTaskStatuses();
      if (existingStatuses.length > 0) {
        return res.json({ message: "Data already seeded" });
      }

      // Seed task statuses
      const statuses = [
        { name: "To Do", color: "#6b7280", order: 0 },
        { name: "In Progress", color: "#3b82f6", order: 1 },
        { name: "Waiting", color: "#f59e0b", order: 2 },
        { name: "Completed", color: "#22c55e", order: 3 },
      ];
      const createdStatuses: any[] = [];
      for (const s of statuses) {
        const status = await storage.createTaskStatus(s);
        createdStatuses.push(status);
      }

      // Seed task categories
      const categories = [
        { name: "Google PPC", color: "#4285f4" },
        { name: "Facebook Ads", color: "#1877f2" },
        { name: "SEO", color: "#22c55e" },
        { name: "Content Creation", color: "#8b5cf6" },
        { name: "Social Media", color: "#ec4899" },
        { name: "Analytics", color: "#f59e0b" },
        { name: "Email Marketing", color: "#06b6d4" },
      ];
      const createdCategories: any[] = [];
      for (const c of categories) {
        const category = await storage.createTaskCategory(c);
        createdCategories.push(category);
      }

      // Seed users
      const usersData = [
        { username: "admin", password: "admin123", name: "John Admin", email: "john@agency.com", role: "admin" },
        { username: "sarah", password: "sarah123", name: "Sarah Johnson", email: "sarah@agency.com", role: "coworker" },
        { username: "mike", password: "mike123", name: "Mike Peters", email: "mike@agency.com", role: "coworker" },
        { username: "emily", password: "emily123", name: "Emily Rose", email: "emily@agency.com", role: "coworker" },
      ];
      const createdUsers: any[] = [];
      for (const u of usersData) {
        const user = await storage.createUser(u);
        createdUsers.push(user);
      }

      // Seed clients
      const clientsData = [
        { 
          name: "Laura & Co.", 
          industry: "Fashion Retail", 
          description: "High-end fashion retailer focusing on seasonal collections and influencer marketing.",
          email: "contact@lauraandco.com",
          phone: "+1 (555) 123-4567",
          services: ["Google PPC", "Facebook Ads"],
          monthlyBudget: 15000
        },
        { 
          name: "Tech Solutions Ltd.", 
          industry: "IT Services", 
          description: "B2B technology solutions provider specializing in cloud infrastructure.",
          email: "hello@techsolutions.io",
          phone: "+1 (555) 987-6543",
          services: ["Content Creation", "SEO", "LinkedIn Ads"],
          monthlyBudget: 8500
        },
        { 
          name: "Gourmet Foods", 
          industry: "Food & Beverage", 
          description: "Premium organic food brand with focus on sustainability and local sourcing.",
          email: "info@gourmetfoods.com",
          services: ["Social Media", "Influencer Marketing"],
          monthlyBudget: 5000
        },
      ];
      const createdClients: any[] = [];
      for (const c of clientsData) {
        const client = await storage.createClient(c);
        createdClients.push(client);
      }

      // Seed tasks
      const today = new Date().toISOString().split("T")[0];
      const tasksData = [
        { 
          title: "Weekly Performance Report", 
          statusId: createdStatuses[0].id,
          categoryId: createdCategories[5].id,
          clientId: createdClients[0].id,
          assigneeId: createdUsers[1].id,
          dueDate: today
        },
        { 
          title: "A/B Test Ad Copy", 
          statusId: createdStatuses[2].id,
          categoryId: createdCategories[1].id,
          clientId: createdClients[0].id,
          assigneeId: createdUsers[2].id,
          timeTracked: 30,
          dueDate: "2025-10-29"
        },
        { 
          title: "Launch Spring Campaign", 
          statusId: createdStatuses[3].id,
          categoryId: createdCategories[0].id,
          clientId: createdClients[0].id,
          assigneeId: createdUsers[1].id,
          timeTracked: 60,
          dueDate: "2025-10-26"
        },
        { 
          title: "SEO Audit", 
          description: "Complete website SEO audit and recommendations",
          statusId: createdStatuses[0].id,
          categoryId: createdCategories[2].id,
          clientId: createdClients[1].id,
          assigneeId: createdUsers[3].id,
          dueDate: "2025-12-15"
        },
        { 
          title: "Content Calendar Review", 
          statusId: createdStatuses[1].id,
          categoryId: createdCategories[3].id,
          clientId: createdClients[1].id,
          assigneeId: createdUsers[0].id,
          timeTracked: 45,
          dueDate: "2025-12-10"
        },
        { 
          title: "Social Media Strategy", 
          statusId: createdStatuses[0].id,
          categoryId: createdCategories[4].id,
          clientId: createdClients[2].id,
          assigneeId: createdUsers[2].id,
          dueDate: "2025-12-20"
        },
      ];
      for (const t of tasksData) {
        await storage.createTask(t);
      }

      // Seed announcements
      await storage.createAnnouncement({
        title: "Team Meeting Tomorrow",
        message: "Don't forget about the quarterly review meeting at 10 AM.",
        authorId: createdUsers[0].id
      });
      await storage.createAnnouncement({
        title: "New Client Onboarded",
        message: "Welcome GrowthCo to our client roster! Sarah will be the lead.",
        authorId: createdUsers[0].id
      });

      // Seed default chat channels
      const channelsData = [
        { name: "general", isPrivate: false },
        { name: "ppc-team", isPrivate: false },
        { name: "seo-team", isPrivate: false },
        { name: "announcements", isPrivate: false },
      ];
      for (const c of channelsData) {
        await storage.createChatChannel(c);
      }

      res.json({ message: "Data seeded successfully" });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed data" });
    }
  });

  // ==================== SALES FUNNEL ====================

  // Pipeline Stages
  app.get("/api/pipeline-stages", requireAuth, async (req, res) => {
    try {
      const stages = await storage.getAllPipelineStages();
      res.json(stages);
    } catch (error) {
      console.error("Error fetching pipeline stages:", error);
      res.status(500).json({ error: "Failed to fetch pipeline stages" });
    }
  });

  app.post("/api/pipeline-stages", requireAdmin, async (req, res) => {
    try {
      const parsed = insertPipelineStageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const stage = await storage.createPipelineStage(parsed.data);
      res.status(201).json(stage);
    } catch (error) {
      console.error("Error creating pipeline stage:", error);
      res.status(500).json({ error: "Failed to create pipeline stage" });
    }
  });

  // Lead Sources
  app.get("/api/lead-sources", requireAuth, async (req, res) => {
    try {
      const sources = await storage.getAllLeadSources();
      res.json(sources);
    } catch (error) {
      console.error("Error fetching lead sources:", error);
      res.status(500).json({ error: "Failed to fetch lead sources" });
    }
  });

  app.post("/api/lead-sources", requireAdmin, async (req, res) => {
    try {
      const parsed = insertLeadSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const source = await storage.createLeadSource(parsed.data);
      res.status(201).json(source);
    } catch (error) {
      console.error("Error creating lead source:", error);
      res.status(500).json({ error: "Failed to create lead source" });
    }
  });

  // Leads
  app.get("/api/leads", requireAuth, async (req, res) => {
    try {
      const allLeads = await storage.getAllLeads();
      res.json(allLeads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  app.get("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }
      res.json(lead);
    } catch (error) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ error: "Failed to fetch lead" });
    }
  });

  app.post("/api/leads", requireAuth, async (req, res) => {
    try {
      const parsed = insertLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const lead = await storage.createLead(parsed.data);
      
      // Create initial activity
      await storage.createLeadActivity({
        leadId: lead.id,
        userId: req.session.userId,
        type: "created",
        title: "Lead created",
        description: `Lead "${lead.name}" was created`,
      });
      
      res.status(201).json(lead);
    } catch (error) {
      console.error("Error creating lead:", error);
      res.status(500).json({ error: "Failed to create lead" });
    }
  });

  app.patch("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const existingLead = await storage.getLead(req.params.id);
      if (!existingLead) {
        return res.status(404).json({ error: "Lead not found" });
      }

      const lead = await storage.updateLead(req.params.id, req.body);
      
      // Track stage changes
      if (req.body.stageId && req.body.stageId !== existingLead.stageId) {
        const stages = await storage.getAllPipelineStages();
        const newStage = stages.find(s => s.id === req.body.stageId);
        const oldStage = stages.find(s => s.id === existingLead.stageId);
        
        await storage.createLeadActivity({
          leadId: req.params.id,
          userId: req.session.userId,
          type: "stage_change",
          title: "Stage changed",
          description: `Moved from "${oldStage?.name || 'Unknown'}" to "${newStage?.name || 'Unknown'}"`,
        });

        // Update won/lost timestamps
        if (newStage?.isWon) {
          await storage.updateLead(req.params.id, { wonAt: new Date() });
        } else if (newStage?.isLost) {
          await storage.updateLead(req.params.id, { lostAt: new Date() });
        }
      }
      
      res.json(lead);
    } catch (error) {
      console.error("Error updating lead:", error);
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  app.delete("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLead(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ error: "Failed to delete lead" });
    }
  });

  // Lead Activities
  app.get("/api/leads/:id/activities", requireAuth, async (req, res) => {
    try {
      const activities = await storage.getLeadActivities(req.params.id);
      res.json(activities);
    } catch (error) {
      console.error("Error fetching lead activities:", error);
      res.status(500).json({ error: "Failed to fetch lead activities" });
    }
  });

  app.post("/api/leads/:id/activities", requireAuth, async (req, res) => {
    try {
      const parsed = insertLeadActivitySchema.safeParse({
        ...req.body,
        leadId: req.params.id,
        userId: req.session.userId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const activity = await storage.createLeadActivity(parsed.data);
      res.status(201).json(activity);
    } catch (error) {
      console.error("Error creating lead activity:", error);
      res.status(500).json({ error: "Failed to create lead activity" });
    }
  });

  // Lead Files
  app.get("/api/leads/:id/files", requireAuth, async (req, res) => {
    try {
      const files = await storage.getLeadFiles(req.params.id);
      res.json(files);
    } catch (error) {
      console.error("Error fetching lead files:", error);
      res.status(500).json({ error: "Failed to fetch lead files" });
    }
  });

  app.post("/api/leads/:id/files", requireAuth, async (req, res) => {
    try {
      const parsed = insertLeadFileSchema.safeParse({
        ...req.body,
        leadId: req.params.id,
        userId: req.session.userId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const file = await storage.createLeadFile(parsed.data);
      res.status(201).json(file);
    } catch (error) {
      console.error("Error creating lead file:", error);
      res.status(500).json({ error: "Failed to create lead file" });
    }
  });

  app.delete("/api/leads/:id/files/:fileId", requireAuth, async (req, res) => {
    try {
      await storage.deleteLeadFile(req.params.fileId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting lead file:", error);
      res.status(500).json({ error: "Failed to delete lead file" });
    }
  });

  // API Keys (for external integrations)
  app.get("/api/api-keys", requireAdmin, async (req, res) => {
    try {
      const keys = await storage.getAllApiKeys();
      // Don't expose full key, only first 8 chars
      const safeKeys = keys.map(k => ({
        ...k,
        key: k.key.substring(0, 8) + "..." + k.key.substring(k.key.length - 4),
      }));
      res.json(safeKeys);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      res.status(500).json({ error: "Failed to fetch API keys" });
    }
  });

  app.post("/api/api-keys", requireAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }
      
      // Generate a secure API key
      const key = `pf_${crypto.randomBytes(32).toString("hex")}`;
      
      const apiKey = await storage.createApiKey({
        name,
        key,
        userId: req.session.userId!,
        isActive: true,
      });
      
      // Return the full key only once on creation
      res.status(201).json(apiKey);
    } catch (error) {
      console.error("Error creating API key:", error);
      res.status(500).json({ error: "Failed to create API key" });
    }
  });

  app.delete("/api/api-keys/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteApiKey(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting API key:", error);
      res.status(500).json({ error: "Failed to delete API key" });
    }
  });

  // ==================== EXTERNAL API (for Make.com) ====================
  
  // Middleware to authenticate external API requests
  async function requireApiKey(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "API key required" });
    }
    
    const key = authHeader.substring(7);
    const apiKey = await storage.getApiKeyByKey(key);
    
    if (!apiKey || !apiKey.isActive) {
      return res.status(401).json({ error: "Invalid or inactive API key" });
    }
    
    // Update last used timestamp
    await storage.updateApiKeyLastUsed(apiKey.id);
    
    // Store user ID from API key for tracking
    (req as any).apiKeyUserId = apiKey.userId;
    next();
  }

  // External API - Create Lead
  app.post("/api/external/leads", requireApiKey, async (req, res) => {
    try {
      const parsed = insertLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      
      const lead = await storage.createLead(parsed.data);
      
      // Create initial activity
      await storage.createLeadActivity({
        leadId: lead.id,
        userId: (req as any).apiKeyUserId,
        type: "created",
        title: "Lead created via API",
        description: `Lead "${lead.name}" was created via external API`,
      });
      
      res.status(201).json(lead);
    } catch (error) {
      console.error("External API - Error creating lead:", error);
      res.status(500).json({ error: "Failed to create lead" });
    }
  });

  // External API - Get Leads
  app.get("/api/external/leads", requireApiKey, async (req, res) => {
    try {
      const allLeads = await storage.getAllLeads();
      res.json(allLeads);
    } catch (error) {
      console.error("External API - Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  // External API - Update Lead
  app.patch("/api/external/leads/:id", requireApiKey, async (req, res) => {
    try {
      const existingLead = await storage.getLead(req.params.id);
      if (!existingLead) {
        return res.status(404).json({ error: "Lead not found" });
      }

      const lead = await storage.updateLead(req.params.id, req.body);
      
      // Track stage changes
      if (req.body.stageId && req.body.stageId !== existingLead.stageId) {
        const stages = await storage.getAllPipelineStages();
        const newStage = stages.find(s => s.id === req.body.stageId);
        const oldStage = stages.find(s => s.id === existingLead.stageId);
        
        await storage.createLeadActivity({
          leadId: req.params.id,
          userId: (req as any).apiKeyUserId,
          type: "stage_change",
          title: "Stage changed via API",
          description: `Moved from "${oldStage?.name || 'Unknown'}" to "${newStage?.name || 'Unknown'}"`,
        });
      }
      
      res.json(lead);
    } catch (error) {
      console.error("External API - Error updating lead:", error);
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  // External API - Get Pipeline Stages
  app.get("/api/external/pipeline-stages", requireApiKey, async (req, res) => {
    try {
      const stages = await storage.getAllPipelineStages();
      res.json(stages);
    } catch (error) {
      console.error("External API - Error fetching stages:", error);
      res.status(500).json({ error: "Failed to fetch pipeline stages" });
    }
  });

  // External API - Get Lead Sources
  app.get("/api/external/lead-sources", requireApiKey, async (req, res) => {
    try {
      const sources = await storage.getAllLeadSources();
      res.json(sources);
    } catch (error) {
      console.error("External API - Error fetching sources:", error);
      res.status(500).json({ error: "Failed to fetch lead sources" });
    }
  });

  // Seed sales funnel data if not exists
  app.post("/api/seed-sales-funnel", async (req, res) => {
    try {
      const existingStages = await storage.getAllPipelineStages();
      if (existingStages.length > 0) {
        return res.json({ message: "Sales funnel data already exists" });
      }

      // Default pipeline stages
      const pipelineStagesData = [
        { name: "New Lead", color: "#6366f1", order: 0, isWon: false, isLost: false },
        { name: "Contacted", color: "#8b5cf6", order: 1, isWon: false, isLost: false },
        { name: "Qualified", color: "#0ea5e9", order: 2, isWon: false, isLost: false },
        { name: "Proposal Sent", color: "#f59e0b", order: 3, isWon: false, isLost: false },
        { name: "Negotiation", color: "#ec4899", order: 4, isWon: false, isLost: false },
        { name: "Won", color: "#10b981", order: 5, isWon: true, isLost: false },
        { name: "Lost", color: "#ef4444", order: 6, isWon: false, isLost: true },
      ];
      for (const stage of pipelineStagesData) {
        await storage.createPipelineStage(stage);
      }

      // Default lead sources
      const leadSourcesData = [
        { name: "Facebook", color: "#1877f2" },
        { name: "Google", color: "#4285f4" },
        { name: "Website", color: "#22c55e" },
        { name: "Referral", color: "#f97316" },
        { name: "Cold Call", color: "#6366f1" },
        { name: "LinkedIn", color: "#0a66c2" },
        { name: "Other", color: "#6b7280" },
      ];
      for (const source of leadSourcesData) {
        await storage.createLeadSource(source);
      }

      res.json({ message: "Sales funnel data seeded successfully" });
    } catch (error) {
      console.error("Seed sales funnel error:", error);
      res.status(500).json({ error: "Failed to seed sales funnel data" });
    }
  });

  // Seed chat channels if they don't exist
  app.post("/api/seed-channels", async (req, res) => {
    try {
      const existingChannels = await storage.getAllChatChannels();
      if (existingChannels.length > 0) {
        return res.json({ message: "Channels already exist" });
      }

      const channelsData = [
        { name: "general", isPrivate: false },
        { name: "ppc-team", isPrivate: false },
        { name: "seo-team", isPrivate: false },
        { name: "announcements", isPrivate: false },
      ];
      for (const c of channelsData) {
        await storage.createChatChannel(c);
      }

      res.json({ message: "Chat channels seeded successfully" });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed data" });
    }
  });

  // ==================== WebSocket Server ====================
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log("WebSocket client connected");
    
    ws.on("close", () => {
      wsClients.delete(ws);
      console.log("WebSocket client disconnected");
    });
    
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      wsClients.delete(ws);
    });
  });

  return httpServer;
}
