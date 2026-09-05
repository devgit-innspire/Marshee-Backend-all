/**
 * RER (Resting Energy Requirement) Based Calorie Calculation
 * 
 * This module provides calorie burn calculations based on RER methodology,
 * which is more accurate for dogs as it accounts for body weight and activity intensity.
 * 
 * Formula:
 * - Daily RER = 70 × (weight_kg)^0.75
 * - Hourly RER = Daily RER / 24
 * - Minute RER = Hourly RER / 60
 * - Activity Calories = Minute RER × Activity Multiplier × Duration_minutes
 * - Total Daily Calories = RER + Σ(Activity Calories for all behaviors)
 */

/**
 * Activity multipliers for different behaviors
 * Based on research on canine energy expenditure
 */
const ACTIVITY_MULTIPLIERS = {
    // Rest/Sleep (baseline)
    rest: {
        min: 1.0,
        max: 1.0,
        default: 1.0
    },
    rest_periods: {
        min: 1.0,
        max: 1.0,
        default: 1.0
    },
    
    // Walking
    walking: {
        min: 1.5,
        max: 2.0,
        default: 1.75
    },
    walk: {
        min: 1.5,
        max: 2.0,
        default: 1.75
    },
    
    // Trotting
    trotting: {
        min: 2.5,
        max: 3.0,
        default: 2.75
    },
    trot: {
        min: 2.5,
        max: 3.0,
        default: 2.75
    },
    
    // Running/Sprinting
    running: {
        min: 4.0,
        max: 6.0,
        default: 5.0
    },
    run: {
        min: 4.0,
        max: 6.0,
        default: 5.0
    },
    sprinting: {
        min: 4.0,
        max: 6.0,
        default: 5.5
    },
    sprint: {
        min: 4.0,
        max: 6.0,
        default: 5.5
    },
    
    // Jumping
    jumps: {
        min: 3.0,
        max: 4.0,
        default: 3.5
    },
    
    // Stairs
    stairs_up: {
        min: 2.5,
        max: 3.5,
        default: 3.0
    },
    stairs_down: {
        min: 2.5,
        max: 3.5,
        default: 2.75
    },
    
    // Digging
    digging: {
        min: 2.0,
        max: 3.0,
        default: 2.5
    },
    dig: {
        min: 2.0,
        max: 3.0,
        default: 2.5
    },
    
    // Play
    rolling_play: {
        min: 3.0,
        max: 4.5,
        default: 3.75
    },
    rollingPlay: {
        min: 3.0,
        max: 4.5,
        default: 3.75
    },
    rollplay: {
        min: 3.0,
        max: 4.5,
        default: 3.75
    },
    
    // Scratching
    scratches: {
        min: 1.2,
        max: 1.5,
        default: 1.35
    },
    
    // Tail wagging
    tail_wags: {
        min: 1.1,
        max: 1.3,
        default: 1.2
    },
    tailWags: {
        min: 1.1,
        max: 1.3,
        default: 1.2
    },
    tailwags: {
        min: 1.1,
        max: 1.3,
        default: 1.2
    },
    
    // Sniffing (light activity)
    sniffing: {
        min: 1.1,
        max: 1.3,
        default: 1.2
    },
    sniff: {
        min: 1.1,
        max: 1.3,
        default: 1.2
    },
    
    // Other activities (default to moderate)
    limping: {
        min: 1.5,
        max: 2.0,
        default: 1.75
    },
    limp: {
        min: 1.5,
        max: 2.0,
        default: 1.75
    },
    shakes: {
        min: 1.2,
        max: 1.5,
        default: 1.35
    },
    licks: {
        min: 1.1,
        max: 1.3,
        default: 1.2
    },
    freefalls: {
        min: 1.0,
        max: 1.0,
        default: 1.0
    }
};

/**
 * Calculate Daily RER (Resting Energy Requirement)
 * Formula: Daily RER = 70 × (weight_kg)^0.75
 * 
 * @param {number} weightKg - Dog's weight in kilograms
 * @returns {number} Daily RER in calories
 */
const calculateDailyRER = (weightKg) => {
    if (!weightKg || weightKg <= 0) {
        throw new Error('Weight must be a positive number');
    }
    return 70 * Math.pow(weightKg, 0.75);
};

/**
 * Calculate Hourly RER
 * 
 * @param {number} weightKg - Dog's weight in kilograms
 * @returns {number} Hourly RER in calories
 */
const calculateHourlyRER = (weightKg) => {
    const dailyRER = calculateDailyRER(weightKg);
    return dailyRER / 24;
};

/**
 * Calculate Minute RER
 * 
 * @param {number} weightKg - Dog's weight in kilograms
 * @returns {number} Minute RER in calories
 */
const calculateMinuteRER = (weightKg) => {
    const hourlyRER = calculateHourlyRER(weightKg);
    return hourlyRER / 60;
};

/**
 * Get activity multiplier for a given activity type
 * 
 * @param {string} activityType - Type of activity (e.g., 'walking', 'running', 'digging')
 * @param {string} useMultiplier - 'min', 'max', or 'default' (default: 'default')
 * @returns {number} Activity multiplier
 */
const getActivityMultiplier = (activityType, useMultiplier = 'default') => {
    if (!activityType) {
        return 1.0; // Default to rest multiplier
    }
    
    const normalizedType = activityType.toLowerCase().replace(/[_-]/g, '_');

    const activity = ACTIVITY_MULTIPLIERS[normalizedType];
    console.log('activity', activity);
    
    if (!activity) {
        console.warn(`Unknown activity type: ${activityType}, using default multiplier 1.0`);
        return 1.0;
    }
    
    return activity[useMultiplier] || activity.default;
};

/**
 * Calculate calories burned for a specific activity
 * Formula: Activity Calories = Minute RER × Activity Multiplier × Duration_minutes
 * 
 * @param {number} weightKg - Dog's weight in kilograms
 * @param {string} activityType - Type of activity
 * @param {number} durationMinutes - Duration of activity in minutes
 * @param {string} useMultiplier - 'min', 'max', or 'default' (default: 'default')
 * @returns {number} Calories burned for this activity
 */
const calculateActivityCalories = (weightKg, activityType, durationMinutes, useMultiplier = 'default') => {
    if (!durationMinutes || durationMinutes < 0) {
        return 0;
    }
    
    const minuteRER = calculateMinuteRER(weightKg);
    console.log('minuteRER', minuteRER);
    console.log('activityType', activityType);
    console.log('useMultiplier', useMultiplier);
    const multiplier = getActivityMultiplier(activityType, useMultiplier);
    console.log('multiplier', multiplier);
    return minuteRER * multiplier * durationMinutes;
};

/**
 * Convert activity samples to duration in minutes
 * Assumes 50Hz sample rate (50 samples per second)
 * 
 * @param {number} samples - Number of samples
 * @param {number} sampleRateHz - Sample rate in Hz (default: 50)
 * @returns {number} Duration in minutes
 */
const samplesToMinutes = (samples, sampleRateHz = 50) => {
    if (!samples || samples <= 0) {
        return 0;
    }
    const seconds = samples / sampleRateHz;
    return seconds / 60;
};

/**
 * Calculate total calories from activity metrics using RER method
 * 
 * @param {Object} metrics - Activity metrics object with activity counts
 * @param {number} weightKg - Dog's weight in kilograms
 * @param {number} sampleRateHz - Sample rate in Hz (default: 50)
 * @param {string} useMultiplier - 'min', 'max', or 'default' (default: 'default')
 * @returns {Object} Object containing total calories and breakdown by activity
 */
const calculateTotalCaloriesFromMetrics = (metrics, weightKg, sampleRateHz = 50, useMultiplier = 'default') => {
    if (!metrics || !weightKg || weightKg <= 0) {
        return {
            totalCalories: 0,
            rerCalories: 0,
            activityCalories: 0,
            breakdown: {}
        };
    }
    
    const minuteRER = calculateMinuteRER(weightKg);
    const hourlyRER = calculateHourlyRER(weightKg);
    const dailyRER = calculateDailyRER(weightKg);

    console.log('minuteRER', minuteRER);
    console.log('hourlyRER', hourlyRER);
    console.log('dailyRER', dailyRER);
    
    // Calculate activity calories for each activity type
    const breakdown = {};
    let totalActivityCalories = 0;
    
    // Map of metric field names to activity types
    const activityMap = {
        totalSteps: 'walking', // Steps are typically walking (count, not seconds)
        totalWalking: 'walking', // In seconds
        totalTrotting: 'trotting', // In seconds
        totalRunning: 'running', // In seconds
        totalSprinting: 'sprinting', // In seconds
        totalRollingPlay: 'rolling_play', // In seconds
        totalDigging: 'digging', // In seconds
        totalLimping: 'limping', // In seconds
        totalTailWags: 'tail_wags', // In seconds
        totalStairsUp: 'stairs_up', // In seconds
        totalStairsDown: 'stairs_down', // In seconds
        totalSniffing: 'sniffing', // In seconds
        totalScratches: 'scratches', // In seconds
        totalJumps: 'jumps', // Count, not seconds
        totalShakes: 'shakes', // Count, not seconds
        totalLicks: 'licks', // Count, not seconds
        totalFreefalls: 'freefalls', // Count, not seconds
        totalRestPeriods: 'rest' // In seconds
    };
    
    // Calculate calories for each activity
    // Note: Activity metrics (totalWalking, totalRunning, etc.) are stored in SECONDS, not samples
    // Exception: totalSteps, totalJumps, totalShakes, totalLicks, totalFreefalls are counts
    for (const [metricKey, activityType] of Object.entries(activityMap)) {
        const activityValue = metrics[metricKey] || 0;
        if (activityValue > 0) {
            let durationSeconds;
            let durationMinutes;
            
            // Handle different metric types
            if (metricKey === 'totalSteps') {
                // Steps are counts, estimate duration: assume 1 step per 0.5 seconds (walking pace)
                durationSeconds = activityValue * 0.5;
                durationMinutes = durationSeconds / 60;
            } else if (['totalJumps', 'totalShakes', 'totalLicks', 'totalFreefalls'].includes(metricKey)) {
                // These are counts, estimate duration: assume 1 count per 0.1 seconds
                durationSeconds = activityValue * 0.1;
                durationMinutes = durationSeconds / 60;
            } else {
                // All other metrics are in seconds
                durationSeconds = activityValue;
                durationMinutes = durationSeconds / 60;
            }
            
            const calories = calculateActivityCalories(weightKg, activityType, durationMinutes, useMultiplier);
            
            breakdown[activityType] = {
                value: activityValue, // Original value
                durationSeconds: durationSeconds, // Keep full precision
                durationMinutes: durationMinutes, // Keep full precision
                calories: Math.round(calories * 10000) / 10000, // More precision for small values
                multiplier: getActivityMultiplier(activityType, useMultiplier)
            };
            
            totalActivityCalories += calories;
        }
    }
    
    // Calculate RER for the session duration
    // If we have startTsMs and endTsMs, use that; otherwise estimate from total samples
    let sessionDurationMinutes = 0;
    let sessionDurationSeconds = 0;
    let sessionDurationMs = 0;
    
    if (metrics.startTsMs && metrics.endTsMs) {
        sessionDurationMs = metrics.endTsMs - metrics.startTsMs;
        sessionDurationSeconds = sessionDurationMs / 1000;
        sessionDurationMinutes = sessionDurationSeconds / 60;
    } else if (metrics.recordCount) {
        // Estimate from record count (assuming 50Hz)
        sessionDurationSeconds = metrics.recordCount / sampleRateHz;
        sessionDurationMs = sessionDurationSeconds * 1000;
        sessionDurationMinutes = sessionDurationSeconds / 60;
    }
    
    // RER calories for the session (baseline metabolic rate)
    // Use seconds for more precision with short sessions
    const rerCalories = (minuteRER / 60) * sessionDurationSeconds;
    
    // Total calories = RER (baseline) + Activity calories
    const totalCalories = rerCalories + totalActivityCalories;
    
    return {
        totalCalories: Math.round(totalCalories * 10000) / 10000, // More precision for small values
        rerCalories: Math.round(rerCalories * 10000) / 10000,
        activityCalories: Math.round(totalActivityCalories * 10000) / 10000,
        dailyRER: Math.round(dailyRER * 100) / 100,
        hourlyRER: Math.round(hourlyRER * 100) / 100,
        minuteRER: Math.round(minuteRER * 100) / 100,
        sessionDurationMinutes: sessionDurationMinutes, // Keep full precision
        sessionDurationSeconds: sessionDurationSeconds,
        sessionDurationMs: sessionDurationMs,
        breakdown
    };
};

/**
 * Calculate daily total calories from multiple sessions
 * 
 * @param {Array} sessions - Array of session calorie results
 * @param {number} weightKg - Dog's weight in kilograms
 * @returns {Object} Daily calorie summary
 */
const calculateDailyTotalCalories = (sessions, weightKg) => {
    if (!sessions || sessions.length === 0) {
        const dailyRER = calculateDailyRER(weightKg);
        return {
            totalCalories: dailyRER,
            rerCalories: dailyRER,
            activityCalories: 0,
            sessionCount: 0
        };
    }
    
    const dailyRER = calculateDailyRER(weightKg);
    let totalActivityCalories = 0;
    
    sessions.forEach(session => {
        if (session.activityCalories) {
            totalActivityCalories += session.activityCalories;
        }
    });
    
    // Daily total = Daily RER + all activity calories from sessions
    const totalCalories = dailyRER + totalActivityCalories;
    
    return {
        totalCalories: Math.round(totalCalories * 100) / 100,
        rerCalories: Math.round(dailyRER * 100) / 100,
        activityCalories: Math.round(totalActivityCalories * 100) / 100,
        sessionCount: sessions.length
    };
};

module.exports = {
    calculateDailyRER,
    calculateHourlyRER,
    calculateMinuteRER,
    getActivityMultiplier,
    calculateActivityCalories,
    samplesToMinutes,
    calculateTotalCaloriesFromMetrics,
    calculateDailyTotalCalories,
    ACTIVITY_MULTIPLIERS
};

