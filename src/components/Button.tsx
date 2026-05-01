import React from 'react';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  type?: 'primary' | 'secondary' | 'outline';
  disabled?: boolean;
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ 
  label, 
  onClick, 
  type = 'primary', 
  disabled = false,
  className = '' 
}) => {
  const getButtonClass = () => {
    const base = "px-6 py-2.5 rounded-xl font-bold transition-all duration-200 transform active:scale-95 flex items-center justify-center gap-2 border cursor-pointer";
    
    if (type === 'primary') {
      return `${base} bg-[var(--blue)] text-white border-[var(--blue)] hover:shadow-lg hover:brightness-110`;
    }
    if (type === 'secondary') {
      return `${base} bg-[var(--cyan)] text-white border-[var(--cyan)] hover:shadow-lg hover:brightness-110`;
    }
    return `${base} bg-transparent text-[var(--blue)] border-[var(--blue)] hover:bg-blue-50`;
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`${getButtonClass()} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={{
        fontFamily: "'Space Grotesk', sans-serif"
      }}
    >
      {label}
    </button>
  );
};

export default Button;
