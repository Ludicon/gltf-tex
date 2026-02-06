/**
 * Parse command-line arguments into options
 * @param {string[]} args - Command-line arguments
 * @param {object} defaults - Default values for options
 * @returns {object} Parsed options with positional args
 */
export function parseArgs(args, defaults = {}) {
  const options = { ...defaults };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg.startsWith("--")) {
      // Long option
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith("-")) {
        // Option with value
        options[key] = parseValue(nextArg);
        i++; // Skip next argument
      } else {
        // Boolean flag
        options[key] = true;
      }
    } else if (arg.startsWith("-")) {
      // Short option
      const key = arg.slice(1);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith("-")) {
        // Option with value
        options[key] = parseValue(nextArg);
        i++; // Skip next argument
      } else {
        // Boolean flag
        options[key] = true;
      }
    } else {
      // Positional argument
      positional.push(arg);
    }
  }

  options._positional = positional;
  return options;
}

/**
 * Parse a string value to the appropriate type
 * @param {string} value - Value to parse
 * @returns {string|number|boolean} Parsed value
 */
function parseValue(value) {
  // Check for boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Check for number
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;

  // Return as string
  return value;
}

/**
 * Validate that a number is within a range
 * @param {number} value - Value to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {string} name - Name of the parameter for error messages
 * @returns {number} Validated value
 * @throws {Error} If value is out of range
 */
export function validateRange(value, min, max, name) {
  if (typeof value !== "number" || isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}
