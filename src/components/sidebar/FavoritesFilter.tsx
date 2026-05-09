import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { getAllFavoriteIds } from '../../services/favorites';

export default function FavoritesFilter() {
    const { t } = useTranslation();
    const showOnlyFavs = useStore((s) => s.showOnlyFavorites);
    const setShowOnlyFavs = useStore((s) => s.setShowOnlyFavorites);
    const favCount = useMemo(() => getAllFavoriteIds().length, [showOnlyFavs]);

    return (
        <button
            onClick={() => setShowOnlyFavs(!showOnlyFavs)}
            role="button"
            style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                padding: '6px 10px', borderRadius: 6, fontSize: '0.72rem',
                border: `1px solid ${showOnlyFavs ? '#f59e0b' : 'var(--color-border)'}`,
                background: showOnlyFavs ? 'rgba(245,158,11,0.08)' : 'transparent',
                color: showOnlyFavs ? '#f59e0b' : 'var(--color-text-secondary)',
                cursor: 'pointer', fontWeight: showOnlyFavs ? 600 : 400,
            }}
        >
            <Star size={13} fill={showOnlyFavs ? '#f59e0b' : 'none'} />
            {t('sidebar.favorites.label')}
            {favCount > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: '0.66rem', opacity: 0.7 }}>{favCount}</span>
            )}
        </button>
    );
}
