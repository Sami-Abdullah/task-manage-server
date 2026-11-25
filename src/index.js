import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { connectDb } from "./db.js";
import { auth } from "./auth.js"; // ONLY import auth from here
import { toNodeHandler, fromNodeHeaders } from "better-auth/node"; // Import these from better-auth/node
import { Ticket, Counter } from "./models.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));

// Better Auth handles everything under /api/auth/*
// MUST BE BEFORE express.json()
app.all("/api/auth/*", toNodeHandler(auth)); // Note: *splat for Express 5. (If you are on Express 4, change back to "/api/auth/*")

app.use(express.json());

// Setup HTTP server and Socket.io BEFORE using 'io' in routes
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN, credentials: true },
});

// Small helper - reads the session from cookies
async function getUser(req) {
  const session = await auth.api.getSession({ 
    headers: fromNodeHeaders(req.headers) // MUST use fromNodeHeaders
  });
  return session?.user ?? null;
}

// LIST — operator sees own, supervisor sees all
app.get("/api/tickets", async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const filter = user.role === "supervisor" ? {} : { operatorId: user.id };

  const [data, total] = await Promise.all([
    Ticket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Ticket.countDocuments(filter),
  ]);
  res.json({ data, total, page, limit });
});

// CREATE — generates the ticketId
app.post("/api/tickets", async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  if (user.role !== "operator") return res.status(403).json({ message: "Forbidden" });

  const counter = await Counter.findOneAndUpdate(
    {}, { $inc: { seq: 1 } }, { upsert: true, new: true }
  );
  const ticketId = `TF-${String(counter.seq).padStart(5, "0")}`;

  const ticket = await Ticket.create({
    ticketId,
    subject: req.body.subject,
    description: req.body.description,
    priority: req.body.priority,
    operatorId: user.id,
    operatorName: user.name,
  });

  io.to("supervisors").emit("ticket:created", ticket);
  res.status(201).json(ticket);
});

// STATUS — operators can only advance open → in_progress → resolved
app.patch("/api/tickets/:id/status", async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ message: "Not found" });

  if (user.role === "operator") {
    if (ticket.operatorId !== user.id) return res.status(403).json({ message: "Forbidden" });
    const flow = { open: "in_progress", in_progress: "resolved" };
    if (flow[ticket.status] !== req.body.status) {
      return res.status(400).json({ message: "Invalid transition" });
    }
  }

  ticket.status = req.body.status;
  await ticket.save();

  io.to("supervisors").to(`user:${ticket.operatorId}`).emit("ticket:updated", ticket);
  res.json(ticket);
});

// DELETE — operator only, own tickets, hard delete
app.delete("/api/tickets/:id", async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  const ticket = await Ticket.findOneAndDelete({
    _id: req.params.id,
    operatorId: user.id,
  });
  if (!ticket) return res.status(404).json({ message: "Not found" });

  io.to("supervisors").emit("ticket:deleted", { _id: ticket._id });
  res.json({ ok: true });
});

// Socket Connection Logic
io.on("connection", async (socket) => {
  const session = await auth.api.getSession({ 
    headers: fromNodeHeaders(socket.handshake.headers) 
  });
  
  if (!session?.user) return socket.disconnect();

  const { user } = session;
  if (user.role === "supervisor") socket.join("supervisors");
  socket.join(`user:${user.id}`);
});

// Boot
const port = process.env.PORT || 4000;
await connectDb();
server.listen(port, () => console.log(`Server on :${port}`));