# Frontend Update Guide

This file helps you update your frontend when backend changes are made to the chat system.

## 📋 Quick Update Checklist

When backend changes are made, check this file for what needs to be updated in your frontend.

---

## 🔄 Latest Updates

### ✅ Chat System - Complete Implementation
**Date:** Latest  
**Status:** Production Ready

All chat functionality is now available in a single file: `chat-service.ts`

---

## 📁 Required Frontend File

### `chat-service.ts`
**Location:** `frontend/chat-service.ts`  
**Purpose:** Complete chat service with all real-time features

**What it includes:**
- ✅ Socket.io connection management
- ✅ Private messaging (send/receive)
- ✅ Group messaging (send/receive)
- ✅ Typing indicators
- ✅ Online/offline status tracking
- ✅ Read receipts
- ✅ Message reactions
- ✅ Message deletion
- ✅ Group room management

---

## 🔌 API Endpoints Reference

### Base URL
```
http://localhost:8080/api/v1/chats
```

### Endpoints Used by Frontend

#### 1. Send Private Message
```
POST /api/v1/chats/private/messages
Body: { receiverId, content?, attachments?, replyTo?, forwardedFrom? }
```

#### 2. Send Group Message
```
POST /api/v1/chats/groups/:groupId/messages
Body: { content?, attachments?, replyTo?, forwardedFrom? }
```

#### 3. Get Private Messages
```
GET /api/v1/chats/private/:userId/messages?page=1&limit=50&before=messageId
```

#### 4. Get Group Messages
```
GET /api/v1/chats/groups/:groupId/messages?page=1&limit=50&before=messageId
```

#### 5. Mark Message as Read
```
PATCH /api/v1/chats/messages/:messageId/read
```

#### 6. Mark Multiple Messages as Read
```
PATCH /api/v1/chats/messages/read
Body: { messageIds[], receiverId?, groupId? }
```

#### 7. Delete Message
```
DELETE /api/v1/chats/messages/:messageId
```

#### 8. Add Reaction
```
POST /api/v1/chats/messages/:messageId/reactions
Body: { emoji }
```

---

## 🔌 Socket Events Reference

### Client → Server Events

| Event | Data | Description |
|-------|------|-------------|
| `joinGroup` | `groupId: string` | Join a group chat room |
| `leaveGroup` | `groupId: string` | Leave a group chat room |
| `typing` | `{ receiverId?, groupId? }` | Send typing indicator |
| `stopTyping` | `{ receiverId?, groupId? }` | Stop typing indicator |
| `markMessagesRead` | `{ messageIds[], receiverId?, groupId? }` | Mark messages as read |
| `getOnlineStatus` | `{ userIds[] }` | Get online status of users |

### Server → Client Events

| Event | Data | Description |
|-------|------|-------------|
| `privateMessage` | `Message` | New private message received |
| `groupMessage` | `Message` | New group message received |
| `typing` | `{ userId, receiverId, isTyping }` | User is typing (private) |
| `groupTyping` | `{ userId, groupId, isTyping }` | User is typing (group) |
| `userOnline` | `{ userId }` | User came online |
| `userOffline` | `{ userId }` | User went offline |
| `messageRead` | `{ messageId, readBy, receiverId }` | Message was read (private) |
| `groupMessageRead` | `{ messageId, readBy, groupId }` | Message was read (group) |
| `messagesRead` | `{ messageIds[], readBy, receiverId? }` | Multiple messages read |
| `groupMessagesRead` | `{ messageIds[], readBy, groupId }` | Multiple group messages read |
| `messageReaction` | `Message` | Message reaction updated |
| `messageDeleted` | `{ messageId, deletedBy, receiverId?, groupId? }` | Message deleted |
| `joinedGroup` | `{ groupId }` | Successfully joined group |
| `leftGroup` | `{ groupId }` | Successfully left group |
| `onlineStatus` | `{ [userId]: boolean }` | Online status response |
| `error` | `{ message }` | Error occurred |

---

## 📝 Message Type Structure

```typescript
interface Message {
  _id: string;
  sender: {
    _id: string;
    name: string;
    email?: string;
    phoneNumber?: string;
    avatar?: string;
  };
  receiver?: {
    _id: string;
    name: string;
    email?: string;
    phoneNumber?: string;
    avatar?: string;
  };
  group?: {
    _id: string;
    name: string;
  };
  content?: string;
  attachments?: Array<{
    url: string;
    type: 'image' | 'video' | 'file';
    filename?: string;
    size?: number;
    duration?: number;
    thumbnail?: string;
  }>;
  type: 'text' | 'image' | 'video' | 'file';
  reactions: Array<{
    user: {
      _id: string;
      name: string;
      email?: string;
      avatar?: string;
    };
    emoji: string;
    createdAt: string;
  }>;
  readBy: string[];
  isDeleted: boolean;
  replyTo?: {
    _id: string;
    content: string;
    sender: {
      _id: string;
      name: string;
    };
  };
  forwardedFrom?: {
    _id: string;
    content: string;
    sender: {
      _id: string;
      name: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}
```

---

## 🚀 Quick Start Example

```typescript
import { ChatService } from './chat-service';

// Initialize
const chatService = new ChatService(
  'http://localhost:8080',
  () => localStorage.getItem('token')
);

// Connect
await chatService.connect();

// Listen for messages
chatService.onPrivateMessage((message) => {
  console.log('New message:', message);
});

// Send message
await chatService.sendPrivateMessage('userId', 'Hello!');

// Join group
chatService.joinGroup('groupId');

// Typing indicator
chatService.sendTyping('receiverId');

// Mark as read
await chatService.markAsRead('messageId');
```

---

## 🔄 When Backend Changes

### If API Endpoints Change:
1. Update the endpoint URLs in `chat-service.ts`
2. Update request/response types if needed
3. Test all affected methods

### If Socket Events Change:
1. Update event names in `chat-service.ts`
2. Update event data types
3. Update event handlers

### If Message Structure Changes:
1. Update the `Message` interface in `chat-service.ts`
2. Update all methods that use Message type
3. Test message handling

### If Authentication Changes:
1. Update token handling in `ChatService` constructor
2. Update connection method if needed

---

## ✅ Testing Checklist

After updating, test:

- [ ] Socket connection works
- [ ] Private messages send/receive
- [ ] Group messages send/receive
- [ ] Typing indicators work
- [ ] Online status works
- [ ] Read receipts work
- [ ] Message reactions work
- [ ] Message deletion works
- [ ] Group join/leave works
- [ ] Error handling works
- [ ] Reconnection works

---

## 📞 Support

If you encounter issues:
1. Check this guide for the latest API/Socket event changes
2. Verify your `chat-service.ts` matches the latest version
3. Check backend logs for errors
4. Verify authentication token is valid

---

## 📅 Change Log

### Latest (Current)
- ✅ Complete chat system implementation
- ✅ All socket events implemented
- ✅ All API endpoints integrated
- ✅ TypeScript types included
- ✅ Error handling added
- ✅ Auto-reconnection support

---

**Last Updated:** Latest  
**Version:** 1.0.0  
**Status:** Production Ready ✅

