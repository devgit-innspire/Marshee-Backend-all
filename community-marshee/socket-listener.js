// import { io } from "socket.io-client";
// const socket = io("http://localhost:3000", { transports: ["websocket"] });

// socket.on("connect", () => {
//   console.log("connected:", socket.id);
//   // Join rooms you want to listen to:
//   socket.emit("joinPrivate", "68bac9b5abd4d54fc613a4be");
//   socket.emit("joinGroup", "68c15072a1377a7b428d62a9");
// });

// socket.on("privateMessage", (msg) => console.log("privateMessage:", msg));
// socket.on("groupMessage", (msg) => console.log("groupMessage:", msg));
// socket.on("disconnect", () => console.log("disconnected"));



import { io } from "socket.io-client";

// Connect to backend socket server
const socket = io("http://localhost:8080", { transports: ["websocket"] });

// Replace with the logged-in user's ID (from JWT or DB)
const currentUserId = "68ca80294935fbbf0624541d";

socket.on("connect", () => {
  console.log("connected:", socket.id);

  // ✅ Join your own private room (to receive private messages)
  socket.emit("joinPrivate", currentUserId);

  // ✅ Join group rooms you are part of
  socket.emit("joinGroup", "68c15072a1377a7b428d62a9");
});

// ✅ Listen for private messages
socket.on("privateMessage", (msg) => {
  console.log("📩 Private message:", msg);
  // You can update UI here (append to chat window)
});

// ✅ Listen for group messages
socket.on("groupMessage", (msg) => {
  console.log("👥 Group message:", msg);
});

// ✅ Handle disconnect
socket.on("disconnect", () => console.log("disconnected"));
