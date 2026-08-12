import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { BarcodeService, ScannedBarcodeResult } from '../services/barcodeService';
import { AudioFeedbackService } from '../services/audioFeedback';

interface BarcodeScannerContextType {
  isScannerPaused: boolean;
  setScannerPaused: (paused: boolean) => void;
}

const BarcodeScannerContext = createContext<BarcodeScannerContextType | undefined>(undefined);

export const useBarcodeScanner = () => {
  const context = useContext(BarcodeScannerContext);
  if (!context) {
    throw new Error('useBarcodeScanner must be used within a BarcodeScannerProvider');
  }
  return context;
};

interface BarcodeScannerProviderProps {
  children: React.ReactNode;
  onBarcodeScanned: (result: ScannedBarcodeResult) => void;
  charIntervalMs?: number; // Timing window between characters, e.g. 40ms
  minBarcodeLength?: number; // Minimum length of scanned barcode to consider, e.g. 6 chars
}

export const BarcodeScannerProvider: React.FC<BarcodeScannerProviderProps> = ({
  children,
  onBarcodeScanned,
  charIntervalMs = 40,
  minBarcodeLength = 6
}) => {
  const [isScannerPaused, setScannerPaused] = useState(false);
  const keyBuffer = useRef<{ key: string; time: number }[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Ignore if scanning is explicitly paused (e.g. modals are open)
      if (isScannerPaused) {
        return;
      }

      // 2. Ignore keypress if focus is inside a standard text input field (to avoid corrupting form typing),
      // unless that input field has explicitly declared 'data-barcode-target'
      const activeElement = document.activeElement;
      if (activeElement) {
        const tagName = activeElement.tagName.toUpperCase();
        const isInputField = tagName === 'INPUT' || tagName === 'TEXTAREA' || activeElement.getAttribute('contenteditable') === 'true';
        
        if (isInputField) {
          const hasBarcodeTargetAttr = activeElement.hasAttribute('data-barcode-target') || activeElement.hasAttribute('data-barcode-scanner-target');
          if (!hasBarcodeTargetAttr) {
            // Let the input field handle typing normally without global scanner interception
            return;
          }
        }
      }

      // 3. Ignore control modifiers keys
      if (e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      const now = performance.now();
      const buffer = keyBuffer.current;

      // Handle Key buffer timing interval to isolate human typing vs high-speed hardware input
      if (buffer.length > 0) {
        const timeDiff = now - buffer[buffer.length - 1].time;
        
        if (timeDiff > charIntervalMs) {
          // Time diff exceeded threshold; assume it was manual typing, flush current buffer and restart
          keyBuffer.current = [];
        }
      }

      // 4. Capture key details
      if (e.key === 'Enter') {
        // Terminator character detected
        if (buffer.length >= minBarcodeLength) {
          // Intercept Enter key so it doesn't submit forms or trigger clicks on focused elements
          e.preventDefault();
          e.stopPropagation();

          const scannedString = buffer.map((item) => item.key).join('');
          keyBuffer.current = []; // Clear buffer immediately

          // Parse and validate the barcode string
          const parsedResult = BarcodeService.parseBarcode(scannedString);

          if (parsedResult.isValid) {
            // Trigger feedback sound
            AudioFeedbackService.playSuccessBeep();
            // Dispatch result callback
            onBarcodeScanned(parsedResult);
          } else {
            console.warn(`Scanned barcode check failed: ${parsedResult.error || 'Unknown validation error'}`);
            AudioFeedbackService.playErrorBeep();
          }
        } else {
          // Scanned string was too short; discard
          keyBuffer.current = [];
        }
      } else if (e.key.length === 1) {
        // Capture only printable key strokes
        keyBuffer.current.push({ key: e.key, time: now });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to intercept early

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isScannerPaused, onBarcodeScanned, charIntervalMs, minBarcodeLength]);

  return (
    <BarcodeScannerContext.Provider value={{ isScannerPaused, setScannerPaused }}>
      {children}
    </BarcodeScannerContext.Provider>
  );
};
