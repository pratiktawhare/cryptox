import React, { forwardRef } from 'react';

const Input = forwardRef(({
    label,
    error,
    hint,
    icon: Icon = null,
    className = '',
    fullWidth = true,
    ...props
}, ref) => {
    const widthCls = fullWidth ? 'w-full' : '';
    const borderCls = error
        ? 'border-crypto-danger/50 focus:border-crypto-danger focus:ring-crypto-danger/20'
        : 'border-crypto-border focus:border-crypto-primary focus:ring-crypto-primary/20';

    return (
        <div className={`${widthCls} ${className}`}>
            {label && (
                <label className="block text-sm font-medium text-crypto-heading mb-1.5">
                    {label}
                </label>
            )}
            <div className="relative">
                {Icon && (
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Icon className="h-4 w-4 text-crypto-muted" />
                    </div>
                )}
                <input
                    ref={ref}
                    className={`
                        block w-full rounded-lg bg-crypto-input text-crypto-heading
                        border px-3 py-2.5 text-sm
                        placeholder:text-crypto-muted
                        focus:outline-none focus:ring-2
                        transition-all duration-200
                        ${Icon ? 'pl-10' : ''}
                        ${borderCls}
                    `}
                    {...props}
                />
            </div>
            {error && (
                <p className="mt-1.5 text-xs text-crypto-danger font-medium">{error}</p>
            )}
            {hint && !error && (
                <p className="mt-1.5 text-xs text-crypto-muted">{hint}</p>
            )}
        </div>
    );
});

Input.displayName = 'Input';

export default Input;
