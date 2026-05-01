import React from 'react';

interface ProductCardProps {
  title: string;
  price: string;
  image: string;
  description: string;
  category: string;
}

const ProductCard: React.FC<ProductCardProps> = ({ title, price, image, description, category }) => {
  return (
    <div className="metric-card p-0 overflow-hidden" style={{ borderRadius: '1.25rem' }}>
      <div className="relative h-48 overflow-hidden">
        <img 
          src={image} 
          alt={title} 
          className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
        />
        <div className="absolute top-3 left-3">
          <span className="chip bg-white/90 border-none shadow-sm">
            {category}
          </span>
        </div>
      </div>
      
      <div className="p-5">
        <h3 className="text-lg font-bold text-[var(--text-main)] mb-2">
          {title}
        </h3>
        <p className="text-[var(--text-muted)] text-sm mb-4 line-clamp-2" style={{ lineHeight: '1.5' }}>
          {description}
        </p>
        
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--line-soft)]">
          <span className="text-xl font-bold text-[var(--text-main)]">{price}</span>
          <button className="w-9 h-9 rounded-full bg-[var(--bg-page)] text-[var(--blue)] flex items-center justify-center hover:bg-[var(--blue)] hover:text-white transition-all">
            <i className="fas fa-plus text-sm"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
