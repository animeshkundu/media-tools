import { useRef, useState, type DragEvent, type ReactNode } from 'react';

type DropzoneProps = {
  accept: string;
  children: ReactNode;
  disabled?: boolean;
  onFile: (file: File) => void;
};

export function Dropzone({ accept, children, disabled, onFile }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function receive(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) {
      const file = event.dataTransfer.files[0];
      if (file) onFile(file);
    }
  }

  return (
    <div
      className={`grid min-h-[25rem] place-content-center rounded-[1.65rem] border border-dashed px-6 py-12 text-center transition motion-reduce:transition-none ${
        dragging
          ? 'border-emerald-300 bg-emerald-300/[0.09]'
          : 'border-white/15 bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.05),transparent_55%)]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-emerald-300/55 hover:bg-emerald-300/[0.035]'}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={receive}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click();
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <input
        ref={inputRef}
        accept={accept}
        className="hidden"
        disabled={disabled}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      {children}
    </div>
  );
}
