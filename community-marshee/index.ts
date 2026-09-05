

import express from "express";
import dotenv from "dotenv";
import connectDB from "./config/db";
import { surveyConnection } from "./config/surveyDB";
import http from "http";
import setupSocket from "./socket";
import cors from "cors";
import mongoose from "mongoose";
import { SocketId } from "socket.io-adapter";

import setupSwagger from "./config/swagger";

import groupRoutes from "./routes/groupRoutes";
import chatRoutes from "./routes/chatRoutes";
import postRoutes from "./routes/postRoutes";
import connectionRoutes from "./routes/connectionRoutes";
import pollRoutes from "./routes/pollRoutes";
import surveyRoutes from "./routes/surveyRoutes";
import blockRoutes from "./routes/blockRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import commentRoutes from "./routes/commentRoutes";
import webinarRoutes from "./routes/webinarRoutes";
import  courseRoutes from "./routes/courseRoutes";
import moduleRoutes from "./routes/moduleRoutes";
import lessonRoutes from "./routes/lessonRoutes";
import articleRoutes from "./routes/articleRoutes";
import reportRoutes from "./routes/reportRoutes";
import "./models/ModerationReport";
import { errorHandler } from "./middlewares/errorHandler";
import { cleanupOrphanedGroupMembers } from "./jobs/cleanupOrphanedGroupMembers";

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

setupSwagger(app);

app.use(express.json());

app.use(cors());

// Health check routes
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Server is healthy',
        timestamp: new Date().toISOString()
    });
})

app.use("/api/v1/groups", groupRoutes);
app.use("/api/v1/chats", chatRoutes);
app.use("/api/v1/posts", postRoutes);
app.use("/api/v1/connection", connectionRoutes);
app.use("/api/v1/poll", pollRoutes);
app.use("/api/v1/survey", surveyRoutes);
app.use("/api/v1/block", blockRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/comments", commentRoutes);
app.use("/api/v1/webinars", webinarRoutes);
app.use("/api/v1/courses", courseRoutes);
app.use("/api/v1/modules", moduleRoutes);
app.use("/api/v1/lessons", lessonRoutes);
app.use("/api/v1/articles", articleRoutes);
app.use("/api/v1/report", reportRoutes);

app.get("/", (req, res) => {
  res.send("API is running with MongoDB + TypeScript 🚀");
});

// Initialize Socket.IO BEFORE starting server
setupSocket(server, app);

// Socket test endpoint
app.get("/api/v1/socket/test", (req, res) => {
  const { getIO, isUserOnline, getOnlineUsersCount } = require("./socket");
  const socketIO = getIO();
  
  // Get room information
  const rooms: Record<string, number> = {};
  if (socketIO) {
    socketIO.sockets.adapter.rooms.forEach((sockets: Set<SocketId>, roomName: string) => {
      // Only show group and user rooms (not socket IDs)
      if (roomName.startsWith('group_') || roomName.startsWith('user_')) {
        rooms[roomName] = sockets.size;
      }
    });
  }
  
  res.status(200).json({
    success: true,
    socket: {
      initialized: !!socketIO,
      connected: socketIO?.engine?.clientsCount || 0,
      onlineUsers: getOnlineUsersCount(),
      status: socketIO ? "✅ Active" : "❌ Not Initialized",
      rooms: rooms,
    },
    timestamp: new Date().toISOString(),
  });
});

// Centralized error handler (must be after all routes and middleware)
app.use(errorHandler);

const HOST = process.env.HOST || "0.0.0.0";
server.listen(Number(PORT), HOST, () => {
  console.log(`✅ Server listening on ${HOST}:${PORT} (all interfaces)`);
  console.log(`✅ Local:   http://localhost:${PORT}`);
  console.log(`✅ Network: http://<your-ip>:${PORT} (e.g. http://192.168.31.189:${PORT})`);
  console.log(`✅ Socket.IO test: http://localhost:${PORT}/api/v1/socket/test`);
  console.log(`✅ Swagger API docs: http://localhost:${PORT}/api-docs`);

  // Run cleanup of orphaned group members (users deleted from User collection)
  const cleanupIntervalMs = process.env.CLEANUP_ORPHANED_MEMBERS_INTERVAL_MS
    ? parseInt(process.env.CLEANUP_ORPHANED_MEMBERS_INTERVAL_MS, 10)
    : 24 * 60 * 60 * 1000; // default: every 24 hours
  if (cleanupIntervalMs > 0) {
    const runCleanup = () => {
      cleanupOrphanedGroupMembers()
        .then((r) => {
          if (r.groupsUpdated > 0 || r.totalMembersRemoved > 0) {
            console.log(
              `[cleanup] Orphaned group members: ${r.totalMembersRemoved} removed from ${r.groupsUpdated} groups.`
            );
          }
        })
        .catch((err) => console.error("[cleanup] Orphaned group members job failed:", err));
    };
    runCleanup(); // run once on startup
    setInterval(runCleanup, cleanupIntervalMs);
  }
});