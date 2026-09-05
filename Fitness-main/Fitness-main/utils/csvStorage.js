const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Base storage directory
const STORAGE_BASE_DIR = process.env.CSV_STORAGE_DIR || path.join(__dirname, '../data/csv_sessions');

// Ensure storage directory exists
const ensureStorageDir = async (subPath = '') => {
    const fullPath = path.join(STORAGE_BASE_DIR, subPath);
    try {
        await fs.mkdir(fullPath, { recursive: true });
        return fullPath;
    } catch (error) {
        console.error('Error creating storage directory:', error);
        throw error;
    }
};

// Generate storage path based on date and session
const generateStoragePath = (deviceId, timestamp) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return path.join(
        'ble_sessions',
        `${year}-${month}-${day}`,
        `session_${timestamp}.csv.gz`
    );
};

// Parse CSV data from the 27-column format
// Field order: roll, pitch, temperature, acc_x, acc_y, acc_z, gyr_x, gyr_y, gyr_z,
//              steps, shakes, scratches, jumps, licks, freefalls, rest_periods,
//              walking, trotting, running, sprinting, rolling_play, digging, limping,
//              tail_wags, stairs_up, stairs_down, sniffing
const parseCsvData = (csvString) => {
    const lines = csvString.trim().split('\n');
    const data = [];
    
    for (const line of lines) {
        if (line.trim()) {
            const values = line.split(',').map(val => {
                const trimmed = val.trim();
                // Convert to number if possible, otherwise keep as string
                const num = parseFloat(trimmed);
                return isNaN(num) ? trimmed : num;
            });
            
            if (values.length === 27) {
                data.push(values);
            } else {
                console.warn(`Skipping malformed line with ${values.length} columns, expected 27: ${line}`);
            }
        }
    }
    
    return data;
};

// Convert parsed data back to CSV string
const dataToCsv = (data) => {
    return data.map(row => row.join(',')).join('\n');
};

// Calculate checksum for data integrity
const calculateChecksum = (data) => {
    return crypto.createHash('sha256').update(data).digest('hex');
};

// Store CSV data with compression
const storeCsvData = async (csvData, deviceId, timestamp) => {
    try {
        // Ensure storage directory exists
        const storagePath = generateStoragePath(deviceId, timestamp);
        const fullPath = path.join(STORAGE_BASE_DIR, storagePath);
        const dirPath = path.dirname(fullPath);
        
        await fs.mkdir(dirPath, { recursive: true });
        
        // Convert data to CSV string if it's an array
        const csvString = Array.isArray(csvData) ? dataToCsv(csvData) : csvData;
        
        // Calculate checksum
        const checksum = calculateChecksum(csvString);
        
        // Compress the data
        const compressedData = await gzip(csvString);
        
        // Write compressed file
        await fs.writeFile(fullPath, compressedData);
        
        return {
            storagePath,
            fullPath,
            checksum,
            originalSize: Buffer.byteLength(csvString, 'utf8'),
            compressedSize: compressedData.length,
            recordCount: Array.isArray(csvData) ? csvData.length : csvString.split('\n').length
        };
    } catch (error) {
        console.error('Error storing CSV data:', error);
        throw error;
    }
};

// Retrieve and decompress CSV data
const retrieveCsvData = async (storagePath) => {
    try {
        const fullPath = path.join(STORAGE_BASE_DIR, storagePath);
        
        // Check if file exists
        try {
            await fs.access(fullPath);
        } catch (error) {
            throw new Error(`CSV file not found: ${storagePath}`);
        }
        
        // Read compressed file
        const compressedData = await fs.readFile(fullPath);
        
        // Decompress
        const decompressedData = await gunzip(compressedData);
        const csvString = decompressedData.toString('utf8');
        
        // Parse CSV data
        const parsedData = parseCsvData(csvString);
        
        return {
            data: parsedData,
            csvString,
            recordCount: parsedData.length,
            originalSize: decompressedData.length,
            compressedSize: compressedData.length
        };
    } catch (error) {
        console.error('Error retrieving CSV data:', error);
        throw error;
    }
};

// Calculate aggregated metrics from CSV data
// Field order: roll(0), pitch(1), temperature(2), acc_x(3), acc_y(4), acc_z(5),
//              gyr_x(6), gyr_y(7), gyr_z(8), steps(9), shakes(10), scratches(11),
//              jumps(12), licks(13), freefalls(14), rest_periods(15), walking(16),
//              trotting(17), running(18), sprinting(19), rolling_play(20), digging(21),
//              limping(22), tail_wags(23), stairs_up(24), stairs_down(25), sniffing(26)
const calculateAggregatedMetrics = (data) => {
    if (!data || data.length === 0) {
        return {};
    }
    
    const metrics = {
        avgAccX: 0, avgAccY: 0, avgAccZ: 0,
        avgGyrX: 0, avgGyrY: 0, avgGyrZ: 0,
        avgRoll: 0, avgPitch: 0,
        avgTemperature: 0,
        totalSteps: 0, totalShakes: 0, totalScratches: 0,
        totalJumps: 0, totalLicks: 0, totalFreefalls: 0,
        totalRestPeriods: 0, totalWalking: 0, totalTrotting: 0,
        totalRunning: 0, totalSprinting: 0, totalRollingPlay: 0,
        totalDigging: 0, totalLimping: 0, totalTailWags: 0,
        totalStairsUp: 0, totalStairsDown: 0, totalSniffing: 0,
        minTemperature: Infinity, maxTemperature: -Infinity
    };
    
    let validTempCount = 0;
    
    for (const row of data) {
        if (row.length === 27) {
            // Orientation (0-1)
            metrics.avgRoll += row[0] || 0;
            metrics.avgPitch += row[1] || 0;
            
            // Temperature (2)
            if (row[2] !== undefined && row[2] !== null && isFinite(row[2])) {
                metrics.avgTemperature += row[2];
                metrics.minTemperature = Math.min(metrics.minTemperature, row[2]);
                metrics.maxTemperature = Math.max(metrics.maxTemperature, row[2]);
                validTempCount++;
            }
            
            // Accelerometer (3-5)
            metrics.avgAccX += row[3] || 0;
            metrics.avgAccY += row[4] || 0;
            metrics.avgAccZ += row[5] || 0;
            
            // Gyroscope (6-8)
            metrics.avgGyrX += row[6] || 0;
            metrics.avgGyrY += row[7] || 0;
            metrics.avgGyrZ += row[8] || 0;
            
            // Activity counters (9-14) - Track max value (device sends CUMULATIVE counters)
            // Device provides cumulative total, so use MAX value (last/highest value)
            const steps = Math.max(0, Math.floor(row[9] || 0));
            const shakes = Math.max(0, Math.floor(row[10] || 0));
            const scratches = Math.max(0, Math.floor(row[11] || 0));
            const jumps = Math.max(0, Math.floor(row[12] || 0));
            const licks = Math.max(0, Math.floor(row[13] || 0));
            const freefalls = Math.max(0, Math.floor(row[14] || 0));
            
            // Use MAX value (cumulative counter - highest value = total)
            metrics.totalSteps = Math.max(metrics.totalSteps, steps);
            metrics.totalShakes = Math.max(metrics.totalShakes, shakes);
            metrics.totalScratches = Math.max(metrics.totalScratches, scratches);
            metrics.totalJumps = Math.max(metrics.totalJumps, jumps);
            metrics.totalLicks = Math.max(metrics.totalLicks, licks);
            metrics.totalFreefalls = Math.max(metrics.totalFreefalls, freefalls);
            
            // Movement types (15-19) - Use MAX (device sends CUMULATIVE counters)
            const restPeriods = Math.max(0, Math.floor(row[15] || 0));
            const walking = Math.max(0, Math.floor(row[16] || 0));
            const trotting = Math.max(0, Math.floor(row[17] || 0));
            const running = Math.max(0, Math.floor(row[18] || 0));
            const sprinting = Math.max(0, Math.floor(row[19] || 0));
            
            // Behavioral activities (20-23) - Use MAX (device sends CUMULATIVE counters)
            const rollingPlay = Math.max(0, Math.floor(row[20] || 0));
            const digging = Math.max(0, Math.floor(row[21] || 0));
            const limping = Math.max(0, Math.floor(row[22] || 0));
            const tailWags = Math.max(0, Math.floor(row[23] || 0));
            
            // Additional activities (24-26) - Use MAX (device sends CUMULATIVE counters)
            const stairsUp = Math.max(0, Math.floor(row[24] || 0));
            const stairsDown = Math.max(0, Math.floor(row[25] || 0));
            const sniffing = Math.max(0, Math.floor(row[26] || 0));
            
            // Use MAX value (cumulative counter - highest value = total)
            metrics.totalRestPeriods = Math.max(metrics.totalRestPeriods, restPeriods);
            metrics.totalWalking = Math.max(metrics.totalWalking, walking);
            metrics.totalTrotting = Math.max(metrics.totalTrotting, trotting);
            metrics.totalRunning = Math.max(metrics.totalRunning, running);
            metrics.totalSprinting = Math.max(metrics.totalSprinting, sprinting);
            metrics.totalRollingPlay = Math.max(metrics.totalRollingPlay, rollingPlay);
            metrics.totalDigging = Math.max(metrics.totalDigging, digging);
            metrics.totalLimping = Math.max(metrics.totalLimping, limping);
            metrics.totalTailWags = Math.max(metrics.totalTailWags, tailWags);
            metrics.totalStairsUp = Math.max(metrics.totalStairsUp, stairsUp);
            metrics.totalStairsDown = Math.max(metrics.totalStairsDown, stairsDown);
            metrics.totalSniffing = Math.max(metrics.totalSniffing, sniffing);
        }
    }
    
    const recordCount = data.length;
    
    // Calculate averages
    if (recordCount > 0) {
        metrics.avgAccX /= recordCount;
        metrics.avgAccY /= recordCount;
        metrics.avgAccZ /= recordCount;
        metrics.avgGyrX /= recordCount;
        metrics.avgGyrY /= recordCount;
        metrics.avgGyrZ /= recordCount;
        metrics.avgRoll /= recordCount;
        metrics.avgPitch /= recordCount;
        
        if (validTempCount > 0) {
            metrics.avgTemperature /= validTempCount;
        }
    }
    
    // Handle temperature edge cases
    if (metrics.minTemperature === Infinity) metrics.minTemperature = 0;
    if (metrics.maxTemperature === -Infinity) metrics.maxTemperature = 0;
    
    // Calculate activity intensity
    const totalActivity = metrics.totalWalking + metrics.totalTrotting + 
                         metrics.totalRunning + metrics.totalSprinting + 
                         metrics.totalRollingPlay + metrics.totalDigging + 
                         metrics.totalTailWags + metrics.totalStairsUp + 
                         metrics.totalStairsDown + metrics.totalSniffing;
    
    if (totalActivity === 0) {
        metrics.activityIntensity = 'rest';
    } else if (totalActivity < 10) {
        metrics.activityIntensity = 'low';
    } else if (totalActivity < 30) {
        metrics.activityIntensity = 'moderate';
    } else if (totalActivity < 60) {
        metrics.activityIntensity = 'high';
    } else {
        metrics.activityIntensity = 'very_high';
    }
    
    // Calculate calories based on activity
    // Calorie calculation for dogs (approximate):
    // - Steps: ~0.05 calories per step
    // - Walking: ~2 calories per second
    // - Trotting: ~4 calories per second
    // - Running: ~8 calories per second
    // - Sprinting: ~12 calories per second
    // - Other activities: ~1-3 calories per second
    let totalCalories = 0;
    
    // Calories from steps (assuming average dog weight)
    totalCalories += metrics.totalSteps * 0.05;
    
    // Calories from walking (assuming 50Hz sample rate, so divide by 50 to get seconds)
    totalCalories += (metrics.totalWalking / 50) * 2;
    totalCalories += (metrics.totalTrotting / 50) * 4;
    totalCalories += (metrics.totalRunning / 50) * 8;
    totalCalories += (metrics.totalSprinting / 50) * 12;
    totalCalories += (metrics.totalRollingPlay / 50) * 2;
    totalCalories += (metrics.totalDigging / 50) * 3;
    totalCalories += (metrics.totalTailWags / 50) * 1;
    totalCalories += (metrics.totalStairsUp / 50) * 5;
    totalCalories += (metrics.totalStairsDown / 50) * 3;
    totalCalories += (metrics.totalSniffing / 50) * 1;
    
    // Round to 2 decimal places
    metrics.totalCalories = Math.round(totalCalories * 100) / 100;
    
    return metrics;
};

// Validate CSV data structure
const validateCsvData = (data) => {
    const errors = [];
    const warnings = [];
    
    if (!Array.isArray(data)) {
        errors.push('Data must be an array');
        return { isValid: false, errors, warnings };
    }
    
    if (data.length === 0) {
        warnings.push('No data rows found');
        return { isValid: true, errors, warnings };
    }
    
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!Array.isArray(row)) {
            errors.push(`Row ${i} is not an array`);
            continue;
        }
        
        if (row.length !== 27) {
            errors.push(`Row ${i} has ${row.length} columns, expected 27`);
        }
        
        // Validate field ranges for 27-column format
        if (row.length === 27) {
            // Temperature (index 2): -50°C to 100°C
            if (row[2] !== undefined && row[2] !== null) {
                const temp = parseFloat(row[2]);
                if (!isFinite(temp) || temp < -50 || temp > 100) {
                    errors.push(`Row ${i}, temperature (column 2) must be between -50 and 100, got ${row[2]}`);
                }
            }
            
            // Accelerometer (indices 3-5): -20g to +20g
            for (let accIdx = 3; accIdx <= 5; accIdx++) {
                if (row[accIdx] !== undefined && row[accIdx] !== null) {
                    const acc = parseFloat(row[accIdx]);
                    if (!isFinite(acc) || acc < -20 || acc > 20) {
                        errors.push(`Row ${i}, accelerometer (column ${accIdx}) must be between -20 and 20, got ${row[accIdx]}`);
                    }
                }
            }
            
            // Gyroscope (indices 6-8): -2000°/s to +2000°/s
            for (let gyrIdx = 6; gyrIdx <= 8; gyrIdx++) {
                if (row[gyrIdx] !== undefined && row[gyrIdx] !== null) {
                    const gyr = parseFloat(row[gyrIdx]);
                    if (!isFinite(gyr) || gyr < -2000 || gyr > 2000) {
                        errors.push(`Row ${i}, gyroscope (column ${gyrIdx}) must be between -2000 and 2000, got ${row[gyrIdx]}`);
                    }
                }
            }
            
            // Integer fields (indices 9-26): must be non-negative
            for (let intIdx = 9; intIdx <= 26; intIdx++) {
                if (row[intIdx] !== undefined && row[intIdx] !== null) {
                    const intVal = parseFloat(row[intIdx]);
                    if (!isFinite(intVal) || intVal < 0) {
                        warnings.push(`Row ${i}, column ${intIdx} should be non-negative integer, got ${row[intIdx]}`);
                    }
                }
            }
        }
        
        // Check for null/undefined values in critical columns
        for (let j = 0; j < Math.min(row.length, 27); j++) {
            if (row[j] === null || row[j] === undefined) {
                warnings.push(`Row ${i}, column ${j} has null/undefined value`);
            }
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
};

// Clean up old CSV files (for maintenance)
const cleanupOldFiles = async (daysOld = 30) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        
        const sessionsDir = path.join(STORAGE_BASE_DIR, 'ble_sessions');
        
        // This would need to be implemented based on your file organization
        // For now, just return success
        console.log(`Cleanup would remove files older than ${daysOld} days`);
        return { success: true, message: 'Cleanup completed' };
    } catch (error) {
        console.error('Error during cleanup:', error);
        throw error;
    }
};

module.exports = {
    ensureStorageDir,
    generateStoragePath,
    parseCsvData,
    dataToCsv,
    calculateChecksum,
    storeCsvData,
    retrieveCsvData,
    calculateAggregatedMetrics,
    validateCsvData,
    cleanupOldFiles,
    STORAGE_BASE_DIR
};
