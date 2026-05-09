/**
 * SessionTimeoutManager — oturum timeout aboneliğini ve uyarı toast'ını
 * App.tsx'ten izole eden küçük bileşen.
 *
 * Neden ayrı bileşen: sessionTimeoutMinutes her değişiminde App.tsx'in
 * (30+ hook, useDatabaseAssets vb. ağır hook'larla) re-render olması
 * UI donmasına yol açıyordu. Bu bileşen aboneliği izole eder — timeout
 * değişimi yalnızca bu 15 satırlık bileşeni render eder.
 */
import { useState, memo } from 'react';
import { useStore } from '../store/useStore';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import SessionWarningToast from './SessionWarningToast';

interface Props {
    enabled: boolean;
    onTimeout: () => void;
}

function SessionTimeoutManagerInner({ enabled, onTimeout }: Props) {
    const sessionTimeoutMinutes = useStore((s) => s.sessionTimeoutMinutes);
    const [showWarning, setShowWarning] = useState(false);

    const sessionTimeout = useSessionTimeout({
        enabled,
        timeoutMinutes: sessionTimeoutMinutes,
        onTimeout,
        onWarning: () => setShowWarning(true),
    });

    return (
        <SessionWarningToast
            visible={showWarning}
            onExtend={() => { sessionTimeout.extend(); setShowWarning(false); }}
            onDismiss={() => setShowWarning(false)}
            onTimeout={() => { setShowWarning(false); onTimeout(); }}
        />
    );
}

export default memo(SessionTimeoutManagerInner);
