import { type InputHTMLAttributes, useId } from 'react';

interface Props
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  label?: string;
  /** Valor atual (controlado). */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Renderiza o valor à direita do label. */
  showValue?: boolean;
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  showValue = true,
  className = '',
  ...rest
}: Props) {
  const id = useId();

  return (
    <div className={['flex flex-col gap-2', className].join(' ')}>
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={id} className="font-sans text-sm font-medium text-text-muted">
            {label}
          </label>
          {showValue && (
            <span className="font-sans text-sm font-semibold text-text">{value}</span>
          )}
        </div>
      )}
      {/*
        💡 Estilização de input[type=range] cross-browser. Cada navegador tem
        seus pseudo-elementos (::-webkit-slider-thumb, ::-moz-range-thumb).
        Tailwind v4 com arbitrary variants cobre os principais via classes.
      */}
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={[
          'h-2 w-full cursor-pointer appearance-none rounded-full bg-surface',
          // thumb (Chromium/WebKit)
          '[&::-webkit-slider-thumb]:size-4',
          '[&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:bg-accent',
          '[&::-webkit-slider-thumb]:shadow-md',
          '[&::-webkit-slider-thumb]:transition-transform',
          '[&::-webkit-slider-thumb]:hover:scale-110',
          // thumb (Firefox)
          '[&::-moz-range-thumb]:size-4',
          '[&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-0',
          '[&::-moz-range-thumb]:bg-accent',
          '[&::-moz-range-thumb]:shadow-md',
        ].join(' ')}
        {...rest}
      />
    </div>
  );
}
