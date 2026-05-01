/**
 * Utility functions for data validation.
 */

/**
 * Validates an email address.
 */
export const isValidEmail = (email: string): boolean => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

/**
 * Validates a Vietnamese phone number.
 */
export const isValidVNPhone = (phone: string): boolean => {
  const re = /(84|0[3|5|7|8|9])+([0-9]{8})\b/;
  return re.test(phone);
};

/**
 * Checks if a string is empty or just whitespace.
 */
export const isEmpty = (str: string | null | undefined): boolean => {
  return !str || str.trim().length === 0;
};

/**
 * Validates a password (minimum 8 characters, at least one letter and one number).
 */
export const isValidPassword = (password: string): boolean => {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
};
