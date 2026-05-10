/**
 * Sorts the violations by impact level. `critical` > `serious` > `moderate` > `minor`.
 * @param {Array} violations - The array of violations to sort.
 * @returns {Array} - The sorted array of violations.
 */
function sortByImpact(violations) {
  const impactOrder = {
    critical: 1,
    serious: 2,
    moderate: 3,
    minor: 4,
  };

  return violations.sort((a, b) => {
    const impactA = impactOrder[a.impact] || 5;
    const impactB = impactOrder[b.impact] || 5;
    return impactA - impactB;
  });
}

/**
 * Debug logging utility that respects GitHub Actions debug mode
 * @param {string} message - The debug message to log
 * @param {any} data - Optional data to log (will be JSON stringified)
 */
function debugLog(message, data = null) {
  if (process.env.DEBUG === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`🔍 [DEBUG ${timestamp}] ${message}`);
    
    if (data !== null) {
      if (typeof data === 'object') {
        console.log('🔍 [DEBUG] Data:', JSON.stringify(data, null, 2));
      } else {
        console.log('🔍 [DEBUG] Data:', data);
      }
    }
  }
}

export {
  sortByImpact,
  debugLog
};
