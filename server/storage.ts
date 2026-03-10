import { 
  type User, type InsertUser,
  type TaskStatus, type InsertTaskStatus,
  type TaskCategory, type InsertTaskCategory,
  type Client, type InsertClient,
  type ClientAssignment, type InsertClientAssignment,
  type Task, type InsertTask,
  type TaskComment, type InsertTaskComment,
  type Announcement, type InsertAnnouncement,
  type TimeEntry, type InsertTimeEntry,
  type ChatChannel, type InsertChatChannel,
  type ChatMessage, type InsertChatMessage,
  type DirectMessage, type InsertDirectMessage,
  type ChannelMember,
  type ClientIncomeHistory, type InsertClientIncomeHistory,
  type PipelineStage, type InsertPipelineStage,
  type LeadSource, type InsertLeadSource,
  type Lead, type InsertLead,
  type LeadActivity, type InsertLeadActivity,
  type LeadFile, type InsertLeadFile,
  type ApiKey, type InsertApiKey,
  users, taskStatuses, taskCategories, clients, clientAssignments, tasks, taskComments, announcements, timeEntries,
  chatChannels, chatMessages, directMessages, channelMembers, clientIncomeHistory,
  pipelineStages, leadSources, leads, leadActivities, leadFiles, apiKeys
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, and, lte } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getAllUsers(): Promise<User[]>;

  // Task Statuses
  getAllTaskStatuses(): Promise<TaskStatus[]>;
  createTaskStatus(status: InsertTaskStatus): Promise<TaskStatus>;

  // Task Categories
  getAllTaskCategories(): Promise<TaskCategory[]>;
  createTaskCategory(category: InsertTaskCategory): Promise<TaskCategory>;

  // Clients
  getAllClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined>;
  deleteClient(id: string): Promise<boolean>;
  getClientAssignments(clientId: string): Promise<(ClientAssignment & { user: User })[]>;
  assignUserToClient(assignment: InsertClientAssignment): Promise<ClientAssignment>;

  // Tasks
  getAllTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  getTasksByClient(clientId: string): Promise<Task[]>;
  getTasksByAssignee(assigneeId: string): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;

  // Task Comments
  getTaskComments(taskId: string): Promise<TaskComment[]>;
  createTaskComment(comment: InsertTaskComment): Promise<TaskComment>;

  // Announcements
  getAllAnnouncements(): Promise<Announcement[]>;
  createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement>;

  // Time Entries
  getTimeEntriesByTask(taskId: string): Promise<TimeEntry[]>;
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  updateTaskTimeTracked(taskId: string, minutes: number): Promise<void>;

  // Chat Channels
  getAllChatChannels(): Promise<ChatChannel[]>;
  getChatChannel(id: string): Promise<ChatChannel | undefined>;
  createChatChannel(channel: InsertChatChannel): Promise<ChatChannel>;
  addChannelMembers(channelId: string, userIds: string[]): Promise<void>;
  getChannelMembers(channelId: string): Promise<ChannelMember[]>;

  // Chat Messages
  getChannelMessages(channelId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;

  // Direct Messages
  getDirectMessages(userId1: string, userId2: string): Promise<DirectMessage[]>;
  createDirectMessage(message: InsertDirectMessage): Promise<DirectMessage>;

  // Client Labor Cost
  getClientLaborCost(clientId: string): Promise<number>;

  // Client Income History
  getClientIncomeHistory(clientId: string): Promise<ClientIncomeHistory[]>;
  addClientIncomeHistory(entry: InsertClientIncomeHistory): Promise<ClientIncomeHistory>;
  getIncomeAtDate(clientId: string, date: Date): Promise<number>;
  getAllClientIncomeHistory(): Promise<ClientIncomeHistory[]>;

  // Pipeline Stages
  getAllPipelineStages(): Promise<PipelineStage[]>;
  createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage>;
  updatePipelineStage(id: string, stage: Partial<InsertPipelineStage>): Promise<PipelineStage | undefined>;

  // Lead Sources
  getAllLeadSources(): Promise<LeadSource[]>;
  createLeadSource(source: InsertLeadSource): Promise<LeadSource>;

  // Leads
  getAllLeads(): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  getLeadsByStage(stageId: string): Promise<Lead[]>;
  getLeadsByAssignee(assigneeId: string): Promise<Lead[]>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, lead: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: string): Promise<boolean>;

  // Lead Activities
  getLeadActivities(leadId: string): Promise<LeadActivity[]>;
  createLeadActivity(activity: InsertLeadActivity): Promise<LeadActivity>;

  // Lead Files
  getLeadFiles(leadId: string): Promise<LeadFile[]>;
  createLeadFile(file: InsertLeadFile): Promise<LeadFile>;
  deleteLeadFile(id: string): Promise<boolean>;

  // API Keys
  getAllApiKeys(): Promise<ApiKey[]>;
  getApiKeyByKey(key: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  updateApiKeyLastUsed(id: string): Promise<void>;
  deleteApiKey(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.passwordResetToken, token));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(user).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    // Delete all related records first (cascade delete)
    await db.delete(taskComments).where(eq(taskComments.userId, id));
    await db.delete(timeEntries).where(eq(timeEntries.userId, id));
    await db.delete(channelMembers).where(eq(channelMembers.userId, id));
    await db.delete(chatMessages).where(eq(chatMessages.userId, id));
    await db.delete(directMessages).where(eq(directMessages.senderId, id));
    await db.delete(directMessages).where(eq(directMessages.receiverId, id));
    await db.delete(clientAssignments).where(eq(clientAssignments.userId, id));
    // Set task assignees to null instead of deleting tasks
    await db.update(tasks).set({ assigneeId: null }).where(eq(tasks.assigneeId, id));
    // Set announcement authors to null
    await db.update(announcements).set({ authorId: null }).where(eq(announcements.authorId, id));
    // Finally delete the user
    await db.delete(users).where(eq(users.id, id));
    return true;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  // Task Statuses
  async getAllTaskStatuses(): Promise<TaskStatus[]> {
    return db.select().from(taskStatuses).orderBy(taskStatuses.order);
  }

  async createTaskStatus(status: InsertTaskStatus): Promise<TaskStatus> {
    const [newStatus] = await db.insert(taskStatuses).values(status).returning();
    return newStatus;
  }

  // Task Categories
  async getAllTaskCategories(): Promise<TaskCategory[]> {
    return db.select().from(taskCategories);
  }

  async createTaskCategory(category: InsertTaskCategory): Promise<TaskCategory> {
    const [newCategory] = await db.insert(taskCategories).values(category).returning();
    return newCategory;
  }

  // Clients
  async getAllClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(clients.name);
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined> {
    const [updated] = await db.update(clients).set(client).where(eq(clients.id, id)).returning();
    return updated;
  }

  async deleteClient(id: string): Promise<boolean> {
    const result = await db.delete(clients).where(eq(clients.id, id));
    return true;
  }

  async getClientAssignments(clientId: string): Promise<(ClientAssignment & { user: User })[]> {
    const assignments = await db.select().from(clientAssignments).where(eq(clientAssignments.clientId, clientId));
    const result: (ClientAssignment & { user: User })[] = [];
    for (const assignment of assignments) {
      const user = await this.getUser(assignment.userId);
      if (user) {
        result.push({ ...assignment, user });
      }
    }
    return result;
  }

  async assignUserToClient(assignment: InsertClientAssignment): Promise<ClientAssignment> {
    const [newAssignment] = await db.insert(clientAssignments).values(assignment).returning();
    return newAssignment;
  }

  // Tasks
  async getAllTasks(): Promise<Task[]> {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async getTasksByClient(clientId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.clientId, clientId));
  }

  async getTasksByAssignee(assigneeId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.assigneeId, assigneeId));
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [newTask] = await db.insert(tasks).values(task).returning();
    return newTask;
  }

  async updateTask(id: string, task: Partial<InsertTask>): Promise<Task | undefined> {
    const [updated] = await db.update(tasks).set({ ...task, updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    await db.delete(tasks).where(eq(tasks.id, id));
    return true;
  }

  // Task Comments
  async getTaskComments(taskId: string): Promise<TaskComment[]> {
    return db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(taskComments.createdAt);
  }

  async createTaskComment(comment: InsertTaskComment): Promise<TaskComment> {
    const [newComment] = await db.insert(taskComments).values(comment).returning();
    return newComment;
  }

  // Announcements
  async getAllAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(desc(announcements.createdAt));
  }

  async createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement> {
    const [newAnnouncement] = await db.insert(announcements).values(announcement).returning();
    return newAnnouncement;
  }

  // Time Entries
  async getTimeEntriesByTask(taskId: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(eq(timeEntries.taskId, taskId));
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    const [newEntry] = await db.insert(timeEntries).values(entry).returning();
    // Also update the task's total time tracked
    const task = await this.getTask(entry.taskId);
    if (task) {
      await this.updateTaskTimeTracked(entry.taskId, (task.timeTracked || 0) + entry.minutes);
    }
    return newEntry;
  }

  async updateTaskTimeTracked(taskId: string, minutes: number): Promise<void> {
    await db.update(tasks).set({ timeTracked: minutes }).where(eq(tasks.id, taskId));
  }

  // Chat Channels
  async getAllChatChannels(): Promise<ChatChannel[]> {
    return db.select().from(chatChannels);
  }

  async getChatChannel(id: string): Promise<ChatChannel | undefined> {
    const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, id));
    return channel;
  }

  async createChatChannel(channel: InsertChatChannel): Promise<ChatChannel> {
    const [newChannel] = await db.insert(chatChannels).values(channel).returning();
    return newChannel;
  }

  async addChannelMembers(channelId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const members = userIds.map(userId => ({ channelId, userId }));
    await db.insert(channelMembers).values(members);
  }

  async getChannelMembers(channelId: string): Promise<ChannelMember[]> {
    return db.select().from(channelMembers).where(eq(channelMembers.channelId, channelId));
  }

  // Chat Messages
  async getChannelMessages(channelId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.channelId, channelId)).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [newMessage] = await db.insert(chatMessages).values(message).returning();
    return newMessage;
  }

  // Direct Messages
  async getDirectMessages(userId1: string, userId2: string): Promise<DirectMessage[]> {
    return db.select().from(directMessages).where(
      or(
        and(eq(directMessages.senderId, userId1), eq(directMessages.receiverId, userId2)),
        and(eq(directMessages.senderId, userId2), eq(directMessages.receiverId, userId1))
      )
    ).orderBy(directMessages.createdAt);
  }

  async createDirectMessage(message: InsertDirectMessage): Promise<DirectMessage> {
    const [newMessage] = await db.insert(directMessages).values(message).returning();
    return newMessage;
  }

  // Client Labor Cost - calculate based on time entries * hourly rates
  async getClientLaborCost(clientId: string): Promise<number> {
    const clientTasks = await this.getTasksByClient(clientId);
    let totalCost = 0;
    
    for (const task of clientTasks) {
      const entries = await this.getTimeEntriesByTask(task.id);
      for (const entry of entries) {
        const user = await this.getUser(entry.userId);
        const hourlyRate = user?.hourlyRate || 0;
        const hours = entry.minutes / 60;
        totalCost += hours * hourlyRate;
      }
    }
    
    return Math.round(totalCost * 100) / 100;
  }

  // Time Tracking Reports
  async getAllTimeEntries(): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).orderBy(desc(timeEntries.createdAt));
  }

  async getTimeEntriesByUser(userId: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(eq(timeEntries.userId, userId)).orderBy(desc(timeEntries.createdAt));
  }

  async getTimeEntriesInDateRange(startDate: Date, endDate: Date): Promise<TimeEntry[]> {
    const { gte, lte } = await import("drizzle-orm");
    return db.select().from(timeEntries)
      .where(and(
        gte(timeEntries.createdAt, startDate),
        lte(timeEntries.createdAt, endDate)
      ))
      .orderBy(desc(timeEntries.createdAt));
  }

  async getUserTimeEntriesInDateRange(userId: string, startDate: Date, endDate: Date): Promise<TimeEntry[]> {
    const { gte, lte } = await import("drizzle-orm");
    return db.select().from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.createdAt, startDate),
        lte(timeEntries.createdAt, endDate)
      ))
      .orderBy(desc(timeEntries.createdAt));
  }

  // Client Income History
  async getClientIncomeHistory(clientId: string): Promise<ClientIncomeHistory[]> {
    return db.select().from(clientIncomeHistory)
      .where(eq(clientIncomeHistory.clientId, clientId))
      .orderBy(desc(clientIncomeHistory.effectiveDate));
  }

  async addClientIncomeHistory(entry: InsertClientIncomeHistory): Promise<ClientIncomeHistory> {
    const [created] = await db.insert(clientIncomeHistory).values(entry).returning();
    return created;
  }

  async getIncomeAtDate(clientId: string, date: Date): Promise<number> {
    // Get the most recent income entry that was effective on or before the given date
    const [entry] = await db.select().from(clientIncomeHistory)
      .where(and(
        eq(clientIncomeHistory.clientId, clientId),
        lte(clientIncomeHistory.effectiveDate, date)
      ))
      .orderBy(desc(clientIncomeHistory.effectiveDate))
      .limit(1);
    return entry?.amount || 0;
  }

  async getAllClientIncomeHistory(): Promise<ClientIncomeHistory[]> {
    return db.select().from(clientIncomeHistory)
      .orderBy(desc(clientIncomeHistory.effectiveDate));
  }

  // ==================== SALES FUNNEL ====================

  // Pipeline Stages
  async getAllPipelineStages(): Promise<PipelineStage[]> {
    return db.select().from(pipelineStages).orderBy(pipelineStages.order);
  }

  async createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage> {
    const [newStage] = await db.insert(pipelineStages).values(stage).returning();
    return newStage;
  }

  async updatePipelineStage(id: string, stage: Partial<InsertPipelineStage>): Promise<PipelineStage | undefined> {
    const [updated] = await db.update(pipelineStages).set(stage).where(eq(pipelineStages.id, id)).returning();
    return updated;
  }

  // Lead Sources
  async getAllLeadSources(): Promise<LeadSource[]> {
    return db.select().from(leadSources);
  }

  async createLeadSource(source: InsertLeadSource): Promise<LeadSource> {
    const [newSource] = await db.insert(leadSources).values(source).returning();
    return newSource;
  }

  // Leads
  async getAllLeads(): Promise<Lead[]> {
    return db.select().from(leads).orderBy(desc(leads.createdAt));
  }

  async getLead(id: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead;
  }

  async getLeadsByStage(stageId: string): Promise<Lead[]> {
    return db.select().from(leads).where(eq(leads.stageId, stageId)).orderBy(desc(leads.createdAt));
  }

  async getLeadsByAssignee(assigneeId: string): Promise<Lead[]> {
    return db.select().from(leads).where(eq(leads.assigneeId, assigneeId)).orderBy(desc(leads.createdAt));
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const [newLead] = await db.insert(leads).values(lead).returning();
    return newLead;
  }

  async updateLead(id: string, lead: Partial<InsertLead>): Promise<Lead | undefined> {
    const [updated] = await db.update(leads).set({ ...lead, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
    return updated;
  }

  async deleteLead(id: string): Promise<boolean> {
    // Delete related records first
    await db.delete(leadActivities).where(eq(leadActivities.leadId, id));
    await db.delete(leadFiles).where(eq(leadFiles.leadId, id));
    await db.delete(leads).where(eq(leads.id, id));
    return true;
  }

  // Lead Activities
  async getLeadActivities(leadId: string): Promise<LeadActivity[]> {
    return db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId)).orderBy(desc(leadActivities.createdAt));
  }

  async createLeadActivity(activity: InsertLeadActivity): Promise<LeadActivity> {
    const [newActivity] = await db.insert(leadActivities).values(activity).returning();
    return newActivity;
  }

  // Lead Files
  async getLeadFiles(leadId: string): Promise<LeadFile[]> {
    return db.select().from(leadFiles).where(eq(leadFiles.leadId, leadId)).orderBy(desc(leadFiles.createdAt));
  }

  async createLeadFile(file: InsertLeadFile): Promise<LeadFile> {
    const [newFile] = await db.insert(leadFiles).values(file).returning();
    return newFile;
  }

  async deleteLeadFile(id: string): Promise<boolean> {
    await db.delete(leadFiles).where(eq(leadFiles.id, id));
    return true;
  }

  // API Keys
  async getAllApiKeys(): Promise<ApiKey[]> {
    return db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  }

  async getApiKeyByKey(key: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.key, key));
    return apiKey;
  }

  async createApiKey(apiKey: InsertApiKey): Promise<ApiKey> {
    const [newApiKey] = await db.insert(apiKeys).values(apiKey).returning();
    return newApiKey;
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  async deleteApiKey(id: string): Promise<boolean> {
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
    return true;
  }
}

export const storage = new DatabaseStorage();
