const DEVICE_ID_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

function normalizeDeviceId(deviceId) {
    if (!deviceId) {
        return null;
    }

    const cleaned = String(deviceId)
        .trim()
        .replace(/-/g, ':')
        .replace(/\s+/g, '');

    const parts = cleaned.split(':').filter(Boolean);
    if (parts.length !== 6) {
        return null;
    }

    const normalizedParts = parts.map((part) => {
        if (part.length === 0 || part.length > 2) {
            return null;
        }
        return part.padStart(2, '0').toUpperCase();
    });

    if (normalizedParts.some((part) => part === null)) {
        return null;
    }

    return normalizedParts.join(':');
}

function validateDeviceId(deviceId) {
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized || !DEVICE_ID_REGEX.test(normalized)) {
        return {
            isValid: false,
            normalized: null
        };
    }

    return {
        isValid: true,
        normalized
    };
}

module.exports = {
    DEVICE_ID_REGEX,
    normalizeDeviceId,
    validateDeviceId
};


