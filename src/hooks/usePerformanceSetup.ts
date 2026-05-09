import { useState, useEffect, useCallback } from 'react';
import {
  detectHardware,
  saveHardwareProfile,
  hasSeenPerformanceSetup,
  markPerformanceSetupSeen,
  getTierRecommendation,
} from '../services/hardwareDetect';
import type { HardwareProfile, HardwareTier } from '../services/hardwareDetect';
import { hasSeenSetupWizard } from '../services/systemCheck';
import { useStore } from '../store/useStore';

export function usePerformanceSetup() {
  const setAiConfig = useStore((s) => s.setAiConfig);

  const [hwProfile, setHwProfile] = useState<HardwareProfile | null>(null);
  const [showPerfSetup, setShowPerfSetup] = useState(false);

  useEffect(() => {
    if (hasSeenPerformanceSetup() || hasSeenSetupWizard()) return;
    const profile = detectHardware();
    saveHardwareProfile(profile);
    setHwProfile(profile);
    setShowPerfSetup(true);
  }, []);

  const handleApplyTier = useCallback(
    (tier: HardwareTier) => {
      const rec = getTierRecommendation(tier);
      setAiConfig((prev) => ({
        ...prev,
        apiProvider: rec.imageSearchProvider === 'none' ? prev.apiProvider : rec.imageSearchProvider,
        apiUrl: 'http://localhost:11434/v1/chat/completions',
      }));
      markPerformanceSetupSeen();
      setShowPerfSetup(false);
    },
    [setAiConfig]
  );

  const handleRetestHardware = useCallback(() => {
    const profile = detectHardware();
    saveHardwareProfile(profile);
    setHwProfile(profile);
  }, []);

  const handleSkipPerfSetup = useCallback(() => {
    markPerformanceSetupSeen();
    setShowPerfSetup(false);
  }, []);

  return {
    hwProfile,
    showPerfSetup,
    handleApplyTier,
    handleRetestHardware,
    handleSkipPerfSetup,
  };
}
