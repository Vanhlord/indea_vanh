import { useState, useCallback } from 'react';

/**
 * Custom hook for handling calculations and logic.
 * Demonstrates the use of .ts for pure logic in React projects.
 */
export const useCalculate = (initialValue: number = 0) => {
  const [value, setValue] = useState<number>(initialValue);

  const add = useCallback((amount: number) => {
    setValue((prev) => prev + amount);
  }, []);

  const subtract = useCallback((amount: number) => {
    setValue((prev) => prev - amount);
  }, []);

  const multiply = useCallback((factor: number) => {
    setValue((prev) => prev * factor);
  }, []);

  const divide = useCallback((divisor: number) => {
    if (divisor === 0) {
      console.error("Cannot divide by zero");
      return;
    }
    setValue((prev) => prev / divisor);
  }, []);

  const reset = useCallback(() => {
    setValue(initialValue);
  }, [initialValue]);

  return {
    value,
    add,
    subtract,
    multiply,
    divide,
    reset
  };
};

export default useCalculate;
