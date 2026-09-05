# Pet Fitness Tracking Backend

This backend extends your existing pet management system with comprehensive fitness band data tracking for pets, capturing real-time activity metrics, sensor data, and health monitoring.

## Features

- **Fitness Band Data**: Complete tracking of all fitness band metrics including activity counts, sensor readings, and device information
- **Activity Metrics**: Track all pet activities including eefalls, rest, walk, trot, run, sprint, rollplay, dig, limp, tailwags, stairs_up, stairs_down, sniff
- **Sensor Data**: Monitor roll, pitch, and temperature readings from the fitness band
- **Health Monitoring**: Track heart rate, steps, calories, distance, and other fitness metrics
- **Device Management**: Monitor battery level, signal strength, and device connectivity

## Prerequisites

- Node.js (>=14.0.0)
- MongoDB (same database as your main backend)
- Firebase Admin SDK setup (same as your main backend)

## Installation

1. Navigate to the extended backend directory:
   ```bash
   cd pets_extended_backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Copy `.env` file and update with your configuration
   - Ensure MongoDB URI points to the same database as your main backend
   - Configure Firebase Admin SDK if needed

4. Start the server:
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## API Endpoints

### Pet Fitness Data
- `GET /api/v1/pet-fitness` - Get all fitness data for user (all pets)
- `GET /api/v1/pet-fitness/pet/:petId` - Get fitness data for specific pet
- `GET /api/v1/pet-fitness/pet/:petId/latest` - Get latest fitness data for pet
- `GET /api/v1/pet-fitness/pet/:petId/stats` - Get fitness statistics for pet
- `POST /api/v1/pet-fitness` - Create new fitness data entry
- `PUT /api/v1/pet-fitness/:fitnessId` - Update fitness data
- `DELETE /api/v1/pet-fitness/:fitnessId` - Delete fitness data

## Authentication

All endpoints require Firebase authentication. Include the Firebase ID token in the Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

## Database Integration

This backend connects to the same MongoDB database as your main backend and references existing User and Pet models. It creates new collections for extended pet data while maintaining referential integrity.

## Health Check

- `GET /health` - Server health status
- `GET /api` - API information and available endpoints

## Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "message": "Error description"
}
```

## Development

The server runs on port 5008 by default (different from your main backend on port 5007) to avoid conflicts. Both backends can run simultaneously.

## API Examples

```bash
# Get all fitness data for a user
GET /api/v1/pet-fitness

# Create new fitness data entry
POST /api/v1/pet-fitness
{
  "petId": "existing-pet-id",
  "roll": 175.67,
  "pitch": -3.14,
  "temp": 32.19,
  "eefalls": 0,
  "rest": 0,
  "walk": 0,
  "trot": 0,
  "run": 0,
  "sprint": 0,
  "rollplay": 0,
  "dig": 0,
  "limp": 0,
  "tailwags": 0,
  "stairs_up": 0,
  "stairs_down": 0,
  "sniff": 0,
  "heartRate": 120,
  "steps": 150,
  "calories": 25.5,
  "distance": 0.5,
  "batteryLevel": 85
}

# Get fitness statistics for a pet
GET /api/v1/pet-fitness/pet/:petId/stats?days=7
```

## Integration with Main Backend

This fitness tracking backend:
- Uses the same database and user authentication
- References existing User and Pet models
- Captures fitness band data for pets
- Can be deployed separately or alongside your main backend
