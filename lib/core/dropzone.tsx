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
      className={`rounded-3xl border border-dashed p-8 text-center transition ${
        dragging ? 'border-emerald-300 bg-emerald-300/10' : 'border-white/20 bg-white/[0.03]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-emerald-400/70'}`}
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
