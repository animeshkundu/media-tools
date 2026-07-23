import { MultitrackTool } from '../../lib/tools/multitrack/MultitrackTool';

type AppProps = {
  surface?: 'extension' | 'web';
};

function StudioMark() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-gradient-to-br from-[#6ec5ff] via-[#438eff] to-[#635bff] text-white shadow-[0_8px_24px_rgba(55,104,244,0.35)]">
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <path d="M4 8h3m3 0h10M4 16h8m3 0h5M7 5v6m5 2v6" />
      </svg>
    </span>
  );
}

export default function App({ surface = 'extension' }: AppProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_50%_-20%,rgba(75,139,255,0.12),transparent_35rem),#0e0f12] text-[#f4f5f7]">
      <a
        className="fixed left-4 top-[-6rem] z-50 rounded-lg bg-[#62b4ff] px-4 py-2 font-bold text-[#07111c] focus:top-4"
        href="#audio-studio"
      >
        Skip to studio
      </a>

      <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-white/10 bg-[#17181c]/92 px-4 shadow-[0_1px_0_rgba(0,0,0,0.7),0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-2xl sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {surface === 'web' ? (
            <a
              className="flex shrink-0 items-center gap-3 text-white no-underline"
              href="/media-tools/"
            >
              <StudioMark />
              <span className="hidden sm:block">
                <h1 className="block text-sm font-extrabold leading-none tracking-[-0.02em]">Audio Studio</h1>
                <small className="mt-1 block text-[0.61rem] font-bold uppercase tracking-[0.15em] text-white/42">
                  Media Tools
                </small>
              </span>
            </a>
          ) : (
            <div className="flex shrink-0 items-center gap-3">
              <StudioMark />
              <span className="hidden sm:block">
                <h1 className="block text-sm font-extrabold leading-none tracking-[-0.02em]">Audio Studio</h1>
                <small className="mt-1 block text-[0.61rem] font-bold uppercase tracking-[0.15em] text-white/42">
                  Extension
                </small>
              </span>
            </div>
          )}
          <span className="hidden h-7 w-px bg-white/10 md:block" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white/82">My audio project</p>
            <p className="mt-0.5 hidden text-[0.62rem] text-white/38 md:block">
              One timeline · non-destructive edits · session only
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[0.64rem] font-semibold text-white/55 lg:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
            WAV + MP3 · 64 MB safety limit
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#63b7ff]/25 bg-[#63b7ff]/10 px-3 py-1.5 text-[0.64rem] font-bold text-[#a8d7ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6cc4ff] shadow-[0_0_0_3px_rgba(108,196,255,0.1)]" aria-hidden="true" />
            {surface === 'extension' ? 'Offline · zero install permissions' : 'Local processing · no upload'}
          </span>
        </div>
      </header>

      <main id="audio-studio">
        <MultitrackTool />
      </main>
    </div>
  );
}
