import type { ButtonHTMLAttributes } from 'react';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-xl bg-emerald-300 px-6 py-3.5 text-sm font-black text-emerald-950 shadow-[0_10px_28px_rgba(52,211,153,0.15)] transition hover:-translate-y-0.5 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transition-none ${className}`}
      {...props}
    />
  );
}
