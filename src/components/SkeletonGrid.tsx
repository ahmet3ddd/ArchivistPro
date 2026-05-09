interface SkeletonGridProps {
    count?: number;
    cardSize?: number;
}

function SkeletonCard({ delay }: { delay: number }) {
    return (
        <div className="skeleton-card animate-card-enter" style={{ animationDelay: `${delay}ms` }}>
            <div className="skeleton-thumb" style={{ animationDelay: `${delay * 0.5}ms` }} />
            <div className="skeleton-body">
                <div className="skeleton-shimmer skeleton-line skeleton-line-long" style={{ animationDelay: `${delay * 0.3}ms` }} />
                <div className="skeleton-shimmer skeleton-line skeleton-line-short" style={{ animationDelay: `${delay * 0.4}ms` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                    <div className="skeleton-shimmer skeleton-line" style={{ width: '35%', animationDelay: `${delay * 0.5}ms` }} />
                    <div className="skeleton-shimmer skeleton-line" style={{ width: '25%', animationDelay: `${delay * 0.6}ms` }} />
                </div>
            </div>
        </div>
    );
}

export default function SkeletonGrid({ count = 12, cardSize = 220 }: SkeletonGridProps) {
    return (
        <div style={{
            flex: 1, overflowY: 'auto', padding: 16,
        }}>
            <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`,
                gap: 12,
                alignContent: 'start',
            }}>
                {Array.from({ length: count }, (_, i) => (
                    <SkeletonCard key={i} delay={i * 40} />
                ))}
            </div>
        </div>
    );
}
