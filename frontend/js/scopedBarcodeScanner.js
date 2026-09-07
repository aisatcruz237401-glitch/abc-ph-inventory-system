(() => {
  function createScopedBarcodeScanner({ videoElement, onDetected, statusElement }) {
    let stream = null;
    let detector = null;
    let animationFrame = null;
    let quaggaActive = false;
    let quaggaDetectedHandler = null;
    let running = false;
    let started = false;
    let lastCode = '';
    let lastDetectedAt = 0;
    let detectionInFlight = false;
    let decoderName = 'none';
    const quaggaReaders = ['code_128_reader'];
    const serializedBarcodePattern = /^(?:AB\d+|ABC\d+-\d+)$/;
    const confirmationWindowMs = 1500;
    const failedLookupCooldownMs = 10000;
    const failedLookupByCode = new Map();
    let confirmationValue = '';
    let confirmationCount = 0;
    let confirmationStartedAt = 0;

    const setStatus = (message, type = 'info') => {
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.className = 'mt-2 rounded bg-slate-100 px-3 py-2 text-xs text-slate-700';
      if (type === 'success') statusElement.className = 'mt-2 rounded bg-emerald-100 px-3 py-2 text-xs text-emerald-800';
      if (type === 'error') statusElement.className = 'mt-2 rounded bg-red-100 px-3 py-2 text-xs text-red-800';
    };

    const normalizeCode = (value) => String(value || '').replace(/[\x00-\x1F\x7F]/g, '').trim().toUpperCase();

    const emitDetected = async (value) => {
      const rawCode = String(value || '');
      const code = normalizeCode(rawCode);
      console.log('[Delivery Scanner] Raw detection:', rawCode);
      console.log('[Delivery Scanner] Normalized detection:', code);

      if (!running || !code) return;

      if (!serializedBarcodePattern.test(code)) {
        console.log('[Delivery Scanner] Rejected invalid barcode:', code);
        confirmationValue = '';
        confirmationCount = 0;
        confirmationStartedAt = 0;
        return;
      }

      const now = Date.now();
      const failedAt = failedLookupByCode.get(code);
      if (failedAt && now - failedAt < failedLookupCooldownMs) {
        if (now - failedAt < 1000) {
          console.log('[Delivery Scanner] Suppressed recent failed barcode:', code);
        }
        return;
      }
      if (failedAt) failedLookupByCode.delete(code);

      if (code === lastCode && now - lastDetectedAt < 1800) return;

      if (code !== confirmationValue || now - confirmationStartedAt > confirmationWindowMs) {
        confirmationValue = code;
        confirmationCount = 1;
        confirmationStartedAt = now;
        console.log('[Delivery Scanner] Confirmation 1/2:', code);
        return;
      }

      confirmationCount += 1;
      console.log('[Delivery Scanner] Confirmation 2/2:', code);

      if (detectionInFlight) return;
      console.log('[Delivery Scanner] Confirmed barcode:', code);

      confirmationValue = '';
      confirmationCount = 0;
      confirmationStartedAt = 0;

      lastCode = code;
      lastDetectedAt = now;
      detectionInFlight = true;

      try {
        const result = await onDetected(code);
        if (result?.success) {
          console.log('[Delivery Scanner] Added successfully:', code);
        } else {
          failedLookupByCode.set(code, Date.now());
          console.log('[Delivery Scanner] Lookup failed/not found:', code, result?.message || 'No unit was added.');
        }
      } catch (error) {
        failedLookupByCode.set(code, Date.now());
        console.error('[Delivery Scanner] Lookup failed/not found:', code, error?.message || error);
      } finally {
        detectionInFlight = false;
      }
    };

    const stopQuagga = () => {
      if (window.Quagga && quaggaActive) {
        try { window.Quagga.stop(); } catch (error) { console.warn('Scoped Quagga stop failed:', error); }
      }
      if (window.Quagga && quaggaDetectedHandler) {
        try { window.Quagga.offDetected(quaggaDetectedHandler); } catch (error) { console.warn('Scoped Quagga handler cleanup failed:', error); }
      }
      quaggaDetectedHandler = null;
      quaggaActive = false;
    };

    const stop = () => {
      running = false;
      started = false;
      detectionInFlight = false;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      stopQuagga();
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      if (videoElement) {
        try { videoElement.pause(); } catch (error) { /* video may already be detached */ }
        videoElement.srcObject = null;
        videoElement.removeAttribute('src');
      }
      detector = null;
      confirmationValue = '';
      confirmationCount = 0;
      confirmationStartedAt = 0;
      failedLookupByCode.clear();
      setStatus('Scanner stopped.', 'info');
    };

    const scanNativeFrame = () => {
      if (!running || !detector) return;
      if (!videoElement.videoWidth || !videoElement.videoHeight) {
        animationFrame = requestAnimationFrame(scanNativeFrame);
        return;
      }
      detector.detect(videoElement).then(results => {
        const value = results?.[0]?.rawValue;
        if (value) void emitDetected(value);
      }).catch(error => {
        console.warn('[Delivery Scanner] Detection error:', error?.message || error);
      }).finally(() => {
        if (running) animationFrame = requestAnimationFrame(scanNativeFrame);
      });
    };

    const startQuagga = () => new Promise((resolve, reject) => {
      if (!window.Quagga) return reject(new Error('Quagga is unavailable.'));
      console.log('[Delivery Scanner] Quagga reader list before initialization:', quaggaReaders);
      quaggaDetectedHandler = result => {
        const code = result?.codeResult?.code;
        if (code) void emitDetected(code);
      };
      window.Quagga.init({
        inputStream: {
          name: 'ScopedDeliveryModal',
          type: 'LiveStream',
          target: videoElement,
          constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        numOfWorkers: 1,
        frequency: 8,
        decoder: { readers: quaggaReaders },
        locate: true,
      }, error => {
        if (error) {
          console.warn('[Delivery Scanner] Detection error:', error?.message || error);
          return reject(error);
        }
        console.log('[Delivery Scanner] Quagga initialized', {
          inputStreamType: 'LiveStream',
          target: videoElement.id || 'scoped video element',
          width: videoElement.videoWidth,
          height: videoElement.videoHeight,
          facingMode: 'environment',
          readers: quaggaReaders,
        });
        window.Quagga.onDetected(quaggaDetectedHandler);
        window.Quagga.start();
        quaggaActive = true;
        decoderName = 'Quagga2';
        resolve();
      });
    });

    const waitForVideoMetadata = () => new Promise((resolve, reject) => {
      if (videoElement.videoWidth && videoElement.videoHeight) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Camera video did not provide dimensions.'));
      }, 8000);
      const onMetadata = () => {
        if (!videoElement.videoWidth || !videoElement.videoHeight) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        videoElement.removeEventListener('loadedmetadata', onMetadata);
      };
      videoElement.addEventListener('loadedmetadata', onMetadata, { once: false });
    });

    const getSupportedFormats = async () => {
      if (typeof window.BarcodeDetector?.getSupportedFormats !== 'function') return [];
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        console.log('[Delivery Scanner] BarcodeDetector supported formats:', formats);
        return formats;
      } catch (error) {
        console.warn('[Delivery Scanner] Detection error:', error?.message || error);
        return [];
      }
    };

    const start = async () => {
      if (started) return;
      if (!videoElement) throw new Error('Scanner video element is missing.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable in this browser.');
      if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
        throw new Error('Camera access requires HTTPS or localhost.');
      }

      started = true;
      running = true;
      setStatus('Starting camera...', 'info');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
        console.log('[Delivery Scanner] Camera started');
        videoElement.srcObject = stream;
        videoElement.muted = true;
        videoElement.playsInline = true;
        await videoElement.play();
        await waitForVideoMetadata();
        console.log('[Delivery Scanner] Video state:', {
          readyState: videoElement.readyState,
          videoWidth: videoElement.videoWidth,
          videoHeight: videoElement.videoHeight,
          paused: videoElement.paused,
        });

        const supportedFormats = await getSupportedFormats();
        const oneDimensionalFormats = ['code_128', 'code_39', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e'];
        const detectorFormats = oneDimensionalFormats.filter(format => supportedFormats.includes(format));
        console.log('[Delivery Scanner] BarcodeDetector available:', typeof window.BarcodeDetector === 'function');

        if (typeof window.BarcodeDetector === 'function' && detectorFormats.length) {
          detector = new window.BarcodeDetector({ formats: detectorFormats });
          decoderName = 'BarcodeDetector';
          setStatus('Looking for barcode...', 'success');
          animationFrame = requestAnimationFrame(scanNativeFrame);
          return;
        }

        if (typeof window.BarcodeDetector === 'function') {
          console.warn('[Delivery Scanner] Detection error: BarcodeDetector has no supported 1D formats.');
        }

        try {
          await startQuagga();
          setStatus('Looking for barcode...', 'success');
        } catch (error) {
          decoderName = 'none';
          console.error('[Delivery Scanner] Quagga initialization failed; no 1D fallback started.', error);
          setStatus('Scanner error: Quagga could not initialize.', 'error');
          throw error;
        }
      } catch (error) {
        console.warn('[Delivery Scanner] Detection error:', error?.message || error);
        stop();
        throw error;
      }
    };

    return { start, stop, isRunning: () => running };
  }

  window.createScopedBarcodeScanner = createScopedBarcodeScanner;
  window.ScopedBarcodeScanner = createScopedBarcodeScanner;
})();
