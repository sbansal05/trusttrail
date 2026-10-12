function buildRingPath(cx: number, cy: number, baseR: number, wobble: number, freq: number): string {
    const points: string[] = [];
    for (let a = 0; a <= 360; a += 4) {
        const rad = (a * Math.PI) / 180;
        const r = baseR + Math.sin(rad * freq) * wobble;
        const x = cx + Math.cos(rad) * r;
        const y = cy + Math.sin(rad) * r * 0.9;
        points.push(`${a === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(" ") + " Z";
}


export function GuillocheBackground() {
    const cx = 320;
    const cy = 40;
    const rings = Array.from({ length: 18 }, (_, ring) => {
        const baseR = 10 + ring * 9;
        const wobble = 6 + (ring % 3) * 2;
        const freq = 7 + (ring % 4);
        return buildRingPath(cx, cy, baseR, wobble, freq);
    });

    return (
        <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            viewBox="0 0 400 160"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
        >
            {rings.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="var(--tt-accent)" strokeWidth="1" opacity="0.08" />
            ))}
        </svg>
    );
}