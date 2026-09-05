# Poll API Documentation for Frontend

This document provides complete API documentation for implementing poll functionality in the frontend.

## Base URL
```
/api/v1/poll
```

## Authentication
All endpoints require authentication. Include the auth token in the request headers:
```
Authorization: Bearer <your_token>
```

---

## API Endpoints

### 1. Create Poll

**Endpoint:** `POST /api/v1/poll/:groupId`

**Description:** Create a new poll in a group

**URL Parameters:**
- `groupId` (string, required) - The ID of the group

**Request Body:**
```json
{
  "question": "What's your favorite programming language?",
  "options": ["JavaScript", "Python", "Java", "C++", "Go"],
  "allowMultiple": false,
  "expiresAt": "2024-12-31T23:59:59Z" // Optional
}
```

**Request Body Fields:**
- `question` (string, required) - Poll question (min 3 characters)
- `options` (array, required) - Array of option strings (min 2 options)
- `allowMultiple` (boolean, optional) - Allow multiple selections (default: false)
- `expiresAt` (string, optional) - ISO date string for poll expiration

**Success Response (201):**
```json
{
  "success": true,
  "message": "Poll created successfully.",
  "data": {
    "_id": "poll_id",
    "question": "What's your favorite programming language?",
    "options": [
      {
        "text": "JavaScript",
        "votes": []
      },
      {
        "text": "Python",
        "votes": []
      }
    ],
    "allowMultiple": false,
    "createdBy": {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "phoneNumber": "1234567890",
      "avatar": "avatar_url"
    },
    "group": {
      "_id": "group_id",
      "name": "Group Name"
    },
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

**Error Responses:**
- `400` - Validation error (missing fields, invalid data)
- `403` - User is not a member of the group
- `404` - Group not found
- `500` - Server error

---

### 2. Get Group Polls

**Endpoint:** `GET /api/v1/poll/:groupId`

**Description:** Get all polls for a specific group

**URL Parameters:**
- `groupId` (string, required) - The ID of the group

**Query Parameters:**
- `page` (number, optional) - Page number (default: 1)
- `limit` (number, optional) - Items per page (default: 10, max: 50)
- `status` (string, optional) - Filter by status: "all", "active", "closed" (default: "all")

**Example Request:**
```
GET /api/v1/poll/507f1f77bcf86cd799439011?page=1&limit=10&status=active
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Polls retrieved successfully.",
  "data": {
    "polls": [
      {
        "_id": "poll_id",
        "question": "What's your favorite programming language?",
        "options": [
          {
            "text": "JavaScript",
            "voteCount": 5,
            "votes": [
              {
                "_id": "user1_id",
                "name": "John Doe",
                "email": "john@example.com",
                "phoneNumber": "1234567890",
                "avatar": "avatar_url"
              },
              {
                "_id": "user2_id",
                "name": "Jane Smith",
                "email": "jane@example.com",
                "phoneNumber": "0987654321",
                "avatar": "avatar_url"
              }
            ],
            "hasVoted": true
          },
          {
            "text": "Python",
            "voteCount": 3,
            "votes": [
              {
                "_id": "user3_id",
                "name": "Bob Johnson",
                "email": "bob@example.com",
                "phoneNumber": "1122334455",
                "avatar": "avatar_url"
              }
            ],
            "hasVoted": false
          }
        ],
        "allowMultiple": false,
        "totalVotes": 8,
        "hasUserVoted": true,
        "createdBy": {
          "_id": "creator_id",
          "name": "Creator Name",
          "email": "creator@example.com",
          "phoneNumber": "9998887776",
          "avatar": "avatar_url"
        },
        "group": "group_id",
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z",
        "expiresAt": null
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 3,
      "totalPolls": 25,
      "hasNext": true,
      "hasPrev": false,
      "limit": 10
    }
  }
}
```

**Response Fields:**
- `polls` - Array of poll objects
  - `options[].voteCount` - Number of votes for this option
  - `options[].votes` - Array of user objects who voted
  - `options[].hasVoted` - Whether current user voted for this option
  - `totalVotes` - Total votes across all options
  - `hasUserVoted` - Whether current user has voted in this poll

---

### 3. Get Single Poll

**Endpoint:** `GET /api/v1/poll/getPoll/:pollId`

**Description:** Get details of a specific poll

**URL Parameters:**
- `pollId` (string, required) - The ID of the poll

**Success Response (200):**
```json
{
  "success": true,
  "message": "Poll retrieved successfully.",
  "data": {
    "_id": "poll_id",
    "question": "What's your favorite programming language?",
    "options": [
      {
        "text": "JavaScript",
        "voteCount": 5,
        "votes": [
          {
            "_id": "user1_id",
            "name": "John Doe",
            "email": "john@example.com",
            "phoneNumber": "1234567890",
            "avatar": "avatar_url"
          }
        ],
        "hasVoted": true
      }
    ],
    "allowMultiple": false,
    "totalVotes": 8,
    "hasUserVoted": true,
    "isExpired": false,
    "createdBy": {
      "_id": "creator_id",
      "name": "Creator Name",
      "email": "creator@example.com",
      "phoneNumber": "9998887776",
      "avatar": "avatar_url"
    },
    "group": {
      "_id": "group_id",
      "name": "Group Name",
      "description": "Group description",
      "coverImage": "cover_image_url"
    },
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "expiresAt": null
  }
}
```

---

### 4. Vote on Poll

**Endpoint:** `POST /api/v1/poll/:pollId/vote`

**Description:** Vote on a poll (single or multiple selection)

**URL Parameters:**
- `pollId` (string, required) - The ID of the poll

**Request Body for Single Selection Poll:**
```json
{
  "optionIndex": 0
}
```

**Request Body for Multiple Selection Poll:**
```json
{
  "optionIndices": [0, 2, 4]
}
```

**OR (also accepts single index for multiple selection polls):**
```json
{
  "optionIndex": 1
}
```

**Request Body Fields:**
- `optionIndex` (number, required for single selection) - Index of the selected option (0-based)
- `optionIndices` (array, required for multiple selection) - Array of option indices

**Success Response (200):**
```json
{
  "success": true,
  "message": "Vote recorded successfully.",
  "data": {
    "_id": "poll_id",
    "question": "What's your favorite programming language?",
    "options": [
      {
        "text": "JavaScript",
        "votes": [
          {
            "_id": "user_id",
            "name": "Your Name",
            "email": "your@example.com",
            "phoneNumber": "1234567890",
            "avatar": "avatar_url"
          }
        ]
      }
    ],
    "allowMultiple": false,
    "createdBy": {...},
    "group": {...}
  }
}
```

**Error Responses:**
- `400` - Invalid option index, poll expired, or validation error
- `403` - User is not a member of the group
- `404` - Poll not found
- `500` - Server error

**Notes:**
- For single selection polls: Use `optionIndex` only
- For multiple selection polls: Use `optionIndices` array (or `optionIndex` which will be converted to array)
- Voting removes previous votes and adds new votes

---

### 5. Update Poll

**Endpoint:** `PUT /api/v1/poll/:pollId`

**Description:** Update a poll (only creator can update, and only before voting starts)

**URL Parameters:**
- `pollId` (string, required) - The ID of the poll

**Request Body:**
```json
{
  "question": "Updated question?",
  "options": ["Option 1", "Option 2", "Option 3"],
  "allowMultiple": true,
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**Request Body Fields (all optional):**
- `question` (string) - Updated question
- `options` (array) - Updated options array
- `allowMultiple` (boolean) - Updated allowMultiple setting
- `expiresAt` (string) - Updated expiration date (or null to clear)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Poll updated successfully.",
  "data": {
    // Updated poll object with populated votes
  }
}
```

**Error Responses:**
- `400` - Cannot update after voting started
- `403` - Only poll creator can update
- `404` - Poll not found
- `500` - Server error

**Note:** Cannot update question or options after voting has started. Cannot change `allowMultiple` after voting has started.

---

### 6. Delete Poll

**Endpoint:** `DELETE /api/v1/poll/:pollId`

**Description:** Delete a poll (only creator or group admin can delete)

**URL Parameters:**
- `pollId` (string, required) - The ID of the poll

**Success Response (200):**
```json
{
  "success": true,
  "message": "Poll deleted successfully.",
  "data": {
    "deletedPollId": "poll_id"
  }
}
```

**Error Responses:**
- `400` - Invalid poll ID
- `403` - Not authorized to delete
- `404` - Poll not found
- `500` - Server error

---

### 7. Close Poll

**Endpoint:** `POST /api/v1/poll/:pollId/close`

**Description:** Close a poll by setting expiration to now (only creator or group admin can close)

**URL Parameters:**
- `pollId` (string, required) - The ID of the poll

**Success Response (200):**
```json
{
  "success": true,
  "message": "Poll closed successfully.",
  "data": {
    // Updated poll object with expiresAt set to current time
  }
}
```

**Error Responses:**
- `400` - Poll already closed
- `403` - Not authorized to close
- `404` - Poll not found
- `500` - Server error

---

## Socket.IO Events

### Listening for Poll Updates

**Join Group Room:**
```javascript
socket.emit('join', `group_${groupId}`);
```

**Events to Listen:**

1. **New Poll Created:**
```javascript
socket.on('newPoll', (poll) => {
  console.log('New poll created:', poll);
  // Update UI with new poll
});
```

2. **Poll Updated (after voting):**
```javascript
socket.on('pollUpdated', (poll) => {
  console.log('Poll updated:', poll);
  // Update poll in UI with new vote counts
});
```

3. **Poll Deleted:**
```javascript
socket.on('pollDeleted', (data) => {
  console.log('Poll deleted:', data.pollId);
  // Remove poll from UI
});
```

---

## Frontend Implementation Examples

### React/TypeScript Example

```typescript
// Types
interface PollOption {
  text: string;
  voteCount: number;
  votes: User[];
  hasVoted: boolean;
}

interface Poll {
  _id: string;
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
  totalVotes: number;
  hasUserVoted: boolean;
  createdBy: User;
  group: string;
  createdAt: string;
  expiresAt?: string;
}

// API Service
class PollService {
  private baseUrl = '/api/v1/poll';

  async createPoll(groupId: string, data: {
    question: string;
    options: string[];
    allowMultiple?: boolean;
    expiresAt?: string;
  }) {
    const response = await fetch(`${this.baseUrl}/${groupId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async getGroupPolls(groupId: string, params?: {
    page?: number;
    limit?: number;
    status?: 'all' | 'active' | 'closed';
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.status) queryParams.append('status', params.status);

    const response = await fetch(
      `${this.baseUrl}/${groupId}?${queryParams.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      }
    );
    return response.json();
  }

  async getPoll(pollId: string) {
    const response = await fetch(`${this.baseUrl}/getPoll/${pollId}`, {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  }

  async votePoll(pollId: string, allowMultiple: boolean, indices: number | number[]) {
    const body = allowMultiple && Array.isArray(indices)
      ? { optionIndices: indices }
      : { optionIndex: Array.isArray(indices) ? indices[0] : indices };

    const response = await fetch(`${this.baseUrl}/${pollId}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(body)
    });
    return response.json();
  }

  async updatePoll(pollId: string, data: {
    question?: string;
    options?: string[];
    allowMultiple?: boolean;
    expiresAt?: string | null;
  }) {
    const response = await fetch(`${this.baseUrl}/${pollId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async deletePoll(pollId: string) {
    const response = await fetch(`${this.baseUrl}/${pollId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  }

  async closePoll(pollId: string) {
    const response = await fetch(`${this.baseUrl}/${pollId}/close`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  }
}

// Usage Example
const pollService = new PollService();

// Create a poll
const newPoll = await pollService.createPoll('group_id', {
  question: 'What is your favorite color?',
  options: ['Red', 'Blue', 'Green'],
  allowMultiple: false
});

// Get polls for a group
const polls = await pollService.getGroupPolls('group_id', {
  page: 1,
  limit: 10,
  status: 'active'
});

// Vote on a poll
await pollService.votePoll('poll_id', false, 0); // Single selection
await pollService.votePoll('poll_id', true, [0, 2]); // Multiple selection
```

### Socket.IO Integration Example

```typescript
import io from 'socket.io-client';

class PollSocketService {
  private socket: any;

  connect(token: string) {
    this.socket = io('your_socket_url', {
      auth: { token }
    });
  }

  joinGroup(groupId: string) {
    this.socket.emit('join', `group_${groupId}`);
  }

  onNewPoll(callback: (poll: Poll) => void) {
    this.socket.on('newPoll', callback);
  }

  onPollUpdated(callback: (poll: Poll) => void) {
    this.socket.on('pollUpdated', callback);
  }

  onPollDeleted(callback: (data: { pollId: string }) => void) {
    this.socket.on('pollDeleted', callback);
  }

  disconnect() {
    this.socket?.disconnect();
  }
}
```

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error message here",
  "errors": ["Additional error details"] // Only in development mode
}
```

**Common Error Codes:**
- `400` - Bad Request (validation errors, invalid data)
- `403` - Forbidden (not authorized, not a member)
- `404` - Not Found (poll/group doesn't exist)
- `500` - Internal Server Error

---

## Important Notes

1. **Vote Counting:** Each option includes `voteCount` (number) and `votes` (array of user objects)

2. **Multiple Selection:** 
   - When `allowMultiple: true`, users can select multiple options
   - Use `optionIndices` array in vote request
   - When `allowMultiple: false`, only `optionIndex` is accepted

3. **Poll Status:**
   - `active` - Poll is still accepting votes
   - `closed` - Poll has expired or been closed
   - Check `isExpired` field or `expiresAt` date

4. **Real-time Updates:** Use Socket.IO events to update UI when polls are created, updated, or deleted

5. **Pagination:** Use pagination parameters to load polls in chunks

6. **User Vote Status:** 
   - `hasUserVoted` - Whether current user voted in the poll
   - `options[].hasVoted` - Whether current user voted for specific option

---

## Quick Reference

| Action | Method | Endpoint | Auth Required |
|--------|--------|----------|---------------|
| Create Poll | POST | `/api/v1/poll/:groupId` | Yes |
| Get Group Polls | GET | `/api/v1/poll/:groupId` | Yes |
| Get Single Poll | GET | `/api/v1/poll/getPoll/:pollId` | Yes |
| Vote on Poll | POST | `/api/v1/poll/:pollId/vote` | Yes |
| Update Poll | PUT | `/api/v1/poll/:pollId` | Yes |
| Delete Poll | DELETE | `/api/v1/poll/:pollId` | Yes |
| Close Poll | POST | `/api/v1/poll/:pollId/close` | Yes |

---

## Support

For questions or issues, refer to the main API documentation or contact the backend team.

