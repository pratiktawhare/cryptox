import React from 'react';

const Button = ({
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    className = '',
    disabled = false,
    loading = false,
    icon: Icon = null,
    ...props
}) => {
    const base = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-crypto-bg cursor-pointer select-none';

    const variants = {
        primary:   'bg-crypto-primary text-white hover:bg-crypto-primary-hover focus:ring-crypto-primary shadow-md hover:shadow-lg hover:shadow-crypto-primary/20',
        secondary: 'bg-crypto-bg-subtle text-crypto-heading border border-crypto-border hover:bg-crypto-card-hover focus:ring-crypto-border',
        danger:    'bg-crypto-danger/10 text-crypto-danger border border-crypto-danger/20 hover:bg-crypto-danger/20 focus:ring-crypto-danger',
        success:   'bg-crypto-success/10 text-crypto-success border border-crypto-success/20 hover:bg-crypto-success/20 focus:ring-crypto-success',
        ghost:     'bg-transparent text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle focus:ring-crypto-border',
    };

    const sizes = {
        sm: 'px-3 py-1.5 text-xs gap-1.5',
        md: 'px-4 py-2.5 text-sm gap-2',
        lg: 'px-6 py-3 text-base gap-2.5',
    };

    const disabledCls = (disabled || loading) ? 'opacity-50 cursor-not-allowed pointer-events-none' : '';
    const widthCls = fullWidth ? 'w-full' : '';

    return (
        <button
            className={`${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${widthCls} ${disabledCls} ${className}`}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
            ) : Icon ? (
                <Icon className="h-4 w-4 shrink-0" />
            ) : null}
            {children}
        </button>
    );
};

export default Button;
