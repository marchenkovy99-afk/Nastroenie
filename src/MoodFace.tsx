import { moods } from './domain';

export function MoodFace({ value, size = 64, selected = false }: {
  value: number;
  size?: number;
  selected?: boolean;
}) {
  const mood = moods[value - 1];

  return (
    <svg className="mood-face" width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      <path
        d="M35 3C54 2 69 14 69 35c1 20-12 34-32 34C16 70 3 57 3 37 2 17 15 4 35 3Z"
        fill={mood?.color}
        stroke={selected ? 'var(--ink)' : 'transparent'}
        strokeWidth="2"
      />
      <g color={mood?.faceColor} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {value === 1 && <path d="M20 27q5 4 9-1M44 26q4 5 9 1M19 19q6 1 9-5M44 14q3 6 9 5M23 52q12-19 25 0" />}
        {(value === 2 || value === 3) && (
          <>
            <circle cx="25" cy="29" r={value === 2 ? 1.6 : 1.4} fill="currentColor" />
            <circle cx="47" cy="29" r={value === 2 ? 1.6 : 1.4} fill="currentColor" />
            <path d={value === 2 ? 'M26 47q10-9 20 0' : 'M25 46h22'} />
          </>
        )}
        {value === 4 && <path d="M20 29q5-9 10 0M42 29q5-9 10 0M25 43q11 16 22 0" />}
        {value === 5 && <path d="M20 28q5-8 10 0M42 28q5-8 10 0M23 41h26q-1 17-13 17T23 41Z" />}
      </g>
    </svg>
  );
}
