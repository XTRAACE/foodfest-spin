import { motion } from 'framer-motion';
import type { Wheel as WheelType } from '../lib/types';

interface WheelProps {
  wheel: WheelType;
  rotation: number;
  spinning: boolean;
  size?: number;
  /** Spin animation length in ms (the ESP32's show duration when it started). */
  durationMs?: number;
  highlightPrizeId?: string | null;
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function sectionPath(radius: number, startAngle: number, endAngle: number) {
  const center = radius + 10;
  const start = polar(center, center, radius, startAngle);
  const end = polar(center, center, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function Wheel({ wheel, rotation, spinning, size = 460, durationMs = 6400, highlightPrizeId }: WheelProps) {
  const center = size / 2;
  const radius = center - 10;
  const sections = wheel.sections;
  const gradientId = 'wheel-hub';

  return (
    <div className="relative select-none" style={{ width: '100%', maxWidth: size }}>
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-orange-500/20 blur-3xl" />

      {/* Fixed pointer at the top */}
      <div className="absolute left-1/2 top-[-14px] z-20 -translate-x-1/2">
        <div className="h-0 w-0 border-x-[14px] border-t-[26px] border-x-transparent border-t-gold drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]" />
        <div className="mx-auto mt-1 h-3 w-3 rounded-full bg-gold shadow-[0_0_12px_rgba(251,191,36,0.9)]" />
      </div>

      <svg viewBox={`0 0 ${size} ${size}`} className="w-full drop-shadow-[0_25px_60px_rgba(0,0,0,0.6)]">
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor="#3b1219" />
            <stop offset="100%" stopColor="#1a070c" />
          </radialGradient>
        </defs>

        <circle cx={center} cy={center} r={radius + 8} fill="url(#wheel-hub)" stroke="rgba(251,191,36,0.55)" strokeWidth={4} />

        <motion.g
          animate={{ rotate: rotation }}
          transition={{
            duration: spinning ? Math.max(0.6, durationMs / 1000) : 0,
            ease: spinning ? [0.12, 0.72, 0.16, 1] : 'linear',
          }}
          style={{ transformOrigin: `${center}px ${center}px` }}
        >
          {sections.map((section, index) => {
            const mid = (section.startAngle + section.endAngle) / 2;
            const labelPoint = polar(center, center, radius * 0.64, mid);
            const isHighlight = highlightPrizeId === section.prizeId;
            return (
              <g key={section.prizeId} opacity={section.eligible ? 1 : 0.38}>
                <path
                  d={sectionPath(radius - 4, section.startAngle, section.endAngle)}
                  fill={section.color}
                  stroke={isHighlight ? '#fff7ed' : 'rgba(0,0,0,0.28)'}
                  strokeWidth={isHighlight ? 4 : 2}
                />
                <g transform={`translate(${labelPoint.x} ${labelPoint.y}) rotate(${mid})`}>
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="font-display"
                    fontSize={sections.length > 6 ? 15 : 18}
                    fontWeight={700}
                    fill="#1a0b0f"
                    style={{ textShadow: '0 1px 0 rgba(255,255,255,0.35)' }}
                  >
                    {section.name.length > 16 ? `${section.name.slice(0, 15)}…` : section.name}
                  </text>
                  {!section.isUnlimited && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      y={sections.length > 6 ? 17 : 20}
                      fontSize={10}
                      fill="rgba(26,11,15,0.65)"
                      fontWeight={600}
                    >
                      {section.eligible ? `${section.stock} left` : 'out of stock'}
                    </text>
                  )}
                </g>
                {/* Divider dots */}
                <circle
                  {...polar(center, center, radius - 10, index === 0 ? 360 : section.startAngle)}
                  r={3}
                  fill="rgba(255,247,237,0.75)"
                />
              </g>
            );
          })}
        </motion.g>

        <circle cx={center} cy={center} r={radius * 0.22} fill="#120709" stroke="rgba(251,191,36,0.5)" strokeWidth={3} />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex h-[19%] w-[19%] flex-col items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-300 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-black shadow-glow">
          <span className="text-[13px] leading-none">FOOD</span>
          <span className="text-[13px] leading-none">FEST</span>
        </div>
      </div>
    </div>
  );
}
