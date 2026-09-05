/**
 * Complete Chat Service - Single File Implementation
 * 
 * This file contains everything needed for the live chat system:
 * - Socket.io connection management
 * - Private and group messaging
 * - Typing indicators
 * - Online/offline status
 * - Read receipts
 * - Message reactions
 * - Message deletion
 * 
 * Usage:
 * ```typescript
 * import { ChatService } from './chat-service';
 * 
 * const chatService = new ChatService('http://localhost:8080', () => localStorage.getItem('token'));
 * 
 * // Connect
 * await chatService.connect();
 * 
 * // Listen for messages
 * chatService.onPrivateMessage((message) => {
 *   console.log('New private message:', message);
 * });
 * 
 * // Send message
 * await chatService.sendPrivateMessage('receiverId', 'Hello!');
 * ```
 */

import { io, Socket } from 'socket.io-client';

// ==================== TYPES ====================

export interface Message {
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
  attachments?: {
    url: string;
    type: 'image' | 'video' | 'file';
    filename?: string;
    size?: number;
    duration?: number;
    thumbnail?: string;
  }[];
  type: 'text' | 'image' | 'video' | 'file';
  reactions: {
    user: {
      _id: string;
      name: string;
      email?: string;
      avatar?: string;
    };
    emoji: string;
    createdAt: string;
  }[];
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

export interface TypingIndicator {
  userId: string;
  receiverId?: string;
  groupId?: string;
  isTyping: boolean;
}

export interface OnlineStatus {
  [userId: string]: boolean;
}

export interface ReadReceipt {
  messageId: string;
  readBy: string;
  receiverId?: string;
  groupId?: string;
}

export interface MessageDeleted {
  messageId: string;
  deletedBy: string;
  receiverId?: string;
  groupId?: string;
}

// ==================== CHAT SERVICE CLASS ====================

export class ChatService {
  private socket: Socket | null = null;
  private baseURL: string;
  private getToken: () => string | null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  // Event callbacks
  private onPrivateMessageCallback?: (message: Message) => void;
  private onGroupMessageCallback?: (message: Message) => void;
  private onTypingCallback?: (data: TypingIndicator) => void;
  private onGroupTypingCallback?: (data: TypingIndicator) => void;
  private onUserOnlineCallback?: (data: { userId: string }) => void;
  private onUserOfflineCallback?: (data: { userId: string }) => void;
  private onMessageReadCallback?: (data: ReadReceipt) => void;
  private onGroupMessageReadCallback?: (data: ReadReceipt) => void;
  private onMessagesReadCallback?: (data: { messageIds: string[]; readBy: string; receiverId?: string }) => void;
  private onGroupMessagesReadCallback?: (data: { messageIds: string[]; readBy: string; groupId: string }) => void;
  private onMessageReactionCallback?: (message: Message) => void;
  private onMessageDeletedCallback?: (data: MessageDeleted) => void;
  private onErrorCallback?: (error: { message: string }) => void;
  private onConnectedCallback?: () => void;
  private onDisconnectedCallback?: () => void;
  private onJoinedGroupCallback?: (data: { groupId: string }) => void;
  private onLeftGroupCallback?: (data: { groupId: string }) => void;

  // Typing timeout handlers
  private typingTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(baseURL: string, getToken: () => string | null) {
    this.baseURL = baseURL;
    this.getToken = getToken;
  }

  // ==================== CONNECTION MANAGEMENT ====================

  /**
   * Connect to the socket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = this.getToken();
      
      if (!token) {
        reject(new Error('No authentication token available'));
        return;
      }

      this.socket = io(this.baseURL, {
        auth: {
          token: token,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
      });

      this.socket.on('connect', () => {
        console.log('✅ Connected to chat server:', this.socket?.id);
        this.reconnectAttempts = 0;
        this.onConnectedCallback?.();
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected from chat server:', reason);
        this.onDisconnectedCallback?.();
        
        if (reason === 'io server disconnect') {
          // Server disconnected, try to reconnect
          this.socket?.connect();
        }
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Failed to connect after multiple attempts'));
        }
      });

      // Setup all event listeners
      this.setupEventListeners();
    });
  }

  /**
   * Disconnect from the socket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Clear all typing timeouts
    this.typingTimeouts.forEach(timeout => clearTimeout(timeout));
    this.typingTimeouts.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Reconnect manually
   */
  async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  // ==================== EVENT LISTENERS SETUP ====================

  private setupEventListeners(): void {
    if (!this.socket) return;

    // Private messages
    this.socket.on('privateMessage', (message: Message) => {
      this.onPrivateMessageCallback?.(message);
    });

    // Group messages
    this.socket.on('groupMessage', (message: Message) => {
      this.onGroupMessageCallback?.(message);
    });

    // Typing indicators
    this.socket.on('typing', (data: TypingIndicator) => {
      this.onTypingCallback?.(data);
    });

    this.socket.on('groupTyping', (data: TypingIndicator) => {
      this.onGroupTypingCallback?.(data);
    });

    // Online/Offline status
    this.socket.on('userOnline', (data: { userId: string }) => {
      this.onUserOnlineCallback?.(data);
    });

    this.socket.on('userOffline', (data: { userId: string }) => {
      this.onUserOfflineCallback?.(data);
    });

    // Read receipts
    this.socket.on('messageRead', (data: ReadReceipt) => {
      this.onMessageReadCallback?.(data);
    });

    this.socket.on('groupMessageRead', (data: ReadReceipt) => {
      this.onGroupMessageReadCallback?.(data);
    });

    this.socket.on('messagesRead', (data: { messageIds: string[]; readBy: string; receiverId?: string }) => {
      this.onMessagesReadCallback?.(data);
    });

    this.socket.on('groupMessagesRead', (data: { messageIds: string[]; readBy: string; groupId: string }) => {
      this.onGroupMessagesReadCallback?.(data);
    });

    // Message reactions
    this.socket.on('messageReaction', (message: Message) => {
      this.onMessageReactionCallback?.(message);
    });

    // Message deletion
    this.socket.on('messageDeleted', (data: MessageDeleted) => {
      this.onMessageDeletedCallback?.(data);
    });

    // Group events
    this.socket.on('joinedGroup', (data: { groupId: string }) => {
      this.onJoinedGroupCallback?.(data);
    });

    this.socket.on('leftGroup', (data: { groupId: string }) => {
      this.onLeftGroupCallback?.(data);
    });

    // Online status response
    this.socket.on('onlineStatus', (statuses: OnlineStatus) => {
      // Handle online status response if needed
    });

    // Error handling
    this.socket.on('error', (error: { message: string }) => {
      console.error('Socket error:', error);
      this.onErrorCallback?.(error);
    });
  }

  // ==================== EVENT CALLBACKS ====================

  onPrivateMessage(callback: (message: Message) => void): void {
    this.onPrivateMessageCallback = callback;
  }

  onGroupMessage(callback: (message: Message) => void): void {
    this.onGroupMessageCallback = callback;
  }

  onTyping(callback: (data: TypingIndicator) => void): void {
    this.onTypingCallback = callback;
  }

  onGroupTyping(callback: (data: TypingIndicator) => void): void {
    this.onGroupTypingCallback = callback;
  }

  onUserOnline(callback: (data: { userId: string }) => void): void {
    this.onUserOnlineCallback = callback;
  }

  onUserOffline(callback: (data: { userId: string }) => void): void {
    this.onUserOfflineCallback = callback;
  }

  onMessageRead(callback: (data: ReadReceipt) => void): void {
    this.onMessageReadCallback = callback;
  }

  onGroupMessageRead(callback: (data: ReadReceipt) => void): void {
    this.onGroupMessageReadCallback = callback;
  }

  onMessagesRead(callback: (data: { messageIds: string[]; readBy: string; receiverId?: string }) => void): void {
    this.onMessagesReadCallback = callback;
  }

  onGroupMessagesRead(callback: (data: { messageIds: string[]; readBy: string; groupId: string }) => void): void {
    this.onGroupMessagesReadCallback = callback;
  }

  onMessageReaction(callback: (message: Message) => void): void {
    this.onMessageReactionCallback = callback;
  }

  onMessageDeleted(callback: (data: MessageDeleted) => void): void {
    this.onMessageDeletedCallback = callback;
  }

  onError(callback: (error: { message: string }) => void): void {
    this.onErrorCallback = callback;
  }

  onConnected(callback: () => void): void {
    this.onConnectedCallback = callback;
  }

  onDisconnected(callback: () => void): void {
    this.onDisconnectedCallback = callback;
  }

  onJoinedGroup(callback: (data: { groupId: string }) => void): void {
    this.onJoinedGroupCallback = callback;
  }

  onLeftGroup(callback: (data: { groupId: string }) => void): void {
    this.onLeftGroupCallback = callback;
  }

  // ==================== GROUP MANAGEMENT ====================

  /**
   * Join a group chat room
   */
  joinGroup(groupId: string): void {
    if (!this.socket?.connected) {
      console.warn('Socket not connected. Cannot join group.');
      return;
    }
    this.socket.emit('joinGroup', groupId);
  }

  /**
   * Leave a group chat room
   */
  leaveGroup(groupId: string): void {
    if (!this.socket?.connected) {
      console.warn('Socket not connected. Cannot leave group.');
      return;
    }
    this.socket.emit('leaveGroup', groupId);
  }

  // ==================== TYPING INDICATORS ====================

  /**
   * Send typing indicator for private chat
   */
  sendTyping(receiverId: string): void {
    if (!this.socket?.connected) return;

    const key = `private_${receiverId}`;
    
    // Clear existing timeout
    const existingTimeout = this.typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Send typing indicator
    this.socket.emit('typing', { receiverId });

    // Auto-stop typing after 3 seconds
    const timeout = setTimeout(() => {
      this.stopTyping(receiverId);
      this.typingTimeouts.delete(key);
    }, 3000);

    this.typingTimeouts.set(key, timeout);
  }

  /**
   * Stop typing indicator for private chat
   */
  stopTyping(receiverId: string): void {
    if (!this.socket?.connected) return;

    const key = `private_${receiverId}`;
    const timeout = this.typingTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.typingTimeouts.delete(key);
    }

    this.socket.emit('stopTyping', { receiverId });
  }

  /**
   * Send typing indicator for group chat
   */
  sendGroupTyping(groupId: string): void {
    if (!this.socket?.connected) return;

    const key = `group_${groupId}`;
    
    // Clear existing timeout
    const existingTimeout = this.typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Send typing indicator
    this.socket.emit('typing', { groupId });

    // Auto-stop typing after 3 seconds
    const timeout = setTimeout(() => {
      this.stopGroupTyping(groupId);
      this.typingTimeouts.delete(key);
    }, 3000);

    this.typingTimeouts.set(key, timeout);
  }

  /**
   * Stop typing indicator for group chat
   */
  stopGroupTyping(groupId: string): void {
    if (!this.socket?.connected) return;

    const key = `group_${groupId}`;
    const timeout = this.typingTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.typingTimeouts.delete(key);
    }

    this.socket.emit('stopTyping', { groupId });
  }

  // ==================== ONLINE STATUS ====================

  /**
   * Get online status of multiple users
   */
  getOnlineStatus(userIds: string[]): Promise<OnlineStatus> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for online status'));
      }, 5000);

      const handler = (statuses: OnlineStatus) => {
        clearTimeout(timeout);
        this.socket?.off('onlineStatus', handler);
        resolve(statuses);
      };

      this.socket.on('onlineStatus', handler);
      this.socket.emit('getOnlineStatus', { userIds });
    });
  }

  // ==================== READ RECEIPTS ====================

  /**
   * Mark messages as read via socket (for real-time updates)
   */
  markMessagesRead(messageIds: string[], receiverId?: string, groupId?: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('markMessagesRead', { messageIds, receiverId, groupId });
  }

  // ==================== API METHODS ====================

  /**
   * Send a private message
   */
  async sendPrivateMessage(
    receiverId: string,
    content?: string,
    attachments?: Array<{
      url: string;
      type: 'image' | 'video' | 'file';
      filename?: string;
      size?: number;
      duration?: number;
      thumbnail?: string;
    }>,
    replyTo?: string,
    forwardedFrom?: string
  ): Promise<Message> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${this.baseURL}/api/v1/chats/private/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        receiverId,
        content,
        attachments,
        type: attachments && attachments.length > 0 ? attachments[0].type : 'text',
        replyTo,
        forwardedFrom,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send message');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Send a group message
   */
  async sendGroupMessage(
    groupId: string,
    content?: string,
    attachments?: Array<{
      url: string;
      type: 'image' | 'video' | 'file';
      filename?: string;
      size?: number;
      duration?: number;
      thumbnail?: string;
    }>,
    replyTo?: string,
    forwardedFrom?: string
  ): Promise<Message> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${this.baseURL}/api/v1/chats/groups/${groupId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        attachments,
        type: attachments && attachments.length > 0 ? attachments[0].type : 'text',
        replyTo,
        forwardedFrom,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send message');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get private messages
   */
  async getPrivateMessages(
    userId: string,
    page: number = 1,
    limit: number = 50,
    before?: string
  ): Promise<{
    messages: Message[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalMessages: number;
      hasNext: boolean;
      hasPrev: boolean;
      limit: number;
    };
  }> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (before) params.append('before', before);

    const response = await fetch(
      `${this.baseURL}/api/v1/chats/private/${userId}/messages?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch messages');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get group messages
   */
  async getGroupMessages(
    groupId: string,
    page: number = 1,
    limit: number = 50,
    before?: string
  ): Promise<{
    messages: Message[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalMessages: number;
      hasNext: boolean;
      hasPrev: boolean;
      limit: number;
    };
  }> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (before) params.append('before', before);

    const response = await fetch(
      `${this.baseURL}/api/v1/chats/groups/${groupId}/messages?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch messages');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<Message> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${this.baseURL}/api/v1/chats/messages/${messageId}/read`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to mark message as read');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Mark multiple messages as read
   */
  async markMultipleAsRead(
    messageIds: string[],
    receiverId?: string,
    groupId?: string
  ): Promise<{ markedCount: number; totalCount: number }> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${this.baseURL}/api/v1/chats/messages/read`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messageIds,
        receiverId,
        groupId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to mark messages as read');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<void> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${this.baseURL}/api/v1/chats/messages/${messageId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete message');
    }
  }

  /**
   * Add reaction to a message
   */
  async addReaction(messageId: string, emoji: string): Promise<Message> {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const response = await fetch(`${this.baseURL}/api/v1/chats/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ emoji }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add reaction');
    }

    const result = await response.json();
    return result.data;
  }
}

// ==================== REACT HOOK EXAMPLE ====================

/**
 * Example React Hook Usage:
 * 
 * ```typescript
 * import { useEffect, useState, useCallback } from 'react';
 * import { ChatService, Message } from './chat-service';
 * 
 * export function useChat() {
 *   const [chatService] = useState(() => 
 *     new ChatService('http://localhost:8080', () => localStorage.getItem('token'))
 *   );
 *   const [messages, setMessages] = useState<Message[]>([]);
 *   const [isConnected, setIsConnected] = useState(false);
 * 
 *   useEffect(() => {
 *     // Connect
 *     chatService.connect().then(() => setIsConnected(true));
 * 
 *     // Listen for messages
 *     chatService.onPrivateMessage((message) => {
 *       setMessages(prev => [...prev, message]);
 *     });
 * 
 *     // Cleanup
 *     return () => {
 *       chatService.disconnect();
 *     };
 *   }, []);
 * 
 *   const sendMessage = useCallback(async (receiverId: string, content: string) => {
 *     await chatService.sendPrivateMessage(receiverId, content);
 *   }, [chatService]);
 * 
 *   return { messages, sendMessage, isConnected };
 * }
 * ```
 */

